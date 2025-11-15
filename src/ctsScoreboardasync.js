/*
 * This is a crude but functional implementation of reading Colorado Time Systems Gen7/WA-2 
 * protocol data off of a serial port. This implementation only supports Swimming data and not other event types that the Gen7 can time.
 * The data stream from a Gen7 Serial timer console via RS-485 is much different than the previous
 * CTS RS-232 data streams from previous generation CTS timers.
 * You can create your own RS-485 to USB serial cable using the following parts:
 *      CONXALL/SWITCHCRAFT P/N 3280-4PG-315  Male plug end  https://www.switchcraft.com/multi-con-x-connectors-0-875-od/multiconx/
 *      FTDI USB-RS485-WE-1800-BT  USB to RS-485 converter  https://ftdichip.com/products/usb-rs485-we-1800-bt/
 *      
 *      ** Wiring for the CTS Gen7 RS-485 socket to the FTDI USB-RS485-WE-1800-BT is as follows, unreferenced wires are trimmed and not used **
 *      BLACK (GND) -> Pin 4
 *      Yellow (Data-) -> Pin 3
 *      Orange (Data+) -> Pin 2
 *      
 *      Below is a ascii drawing of the CTS Gen7 female RS-485 socket pinout as viewed from the back of the timer console, you will be wiring the Male Plug
 *      to the correpsonding pins of the FEMALE socket when the male plug is properly keyed and latched into the socket.
 
 *      TOP 
 *   .---v---.
   /           \
  |   o 1   o 4 |
  |             |
  |   o 2   o 3 |
   \           /
     '-------'
 
     The following is AI generated code commentary, take it as it is...
- Use EventEmitter to expose events: EventChange, HeatChange, ScoreboardReset, ScoreboardStart, ScoreboardBlank, ScoreboardBlankWithTime.
- Use 'serialport' package (user should install separately) for serial communication.
- Represent data structures:
  - Lane: { number, lastName, firstName, team, property change not necessary }
  - Heat: array of 12 Lane objects + HasGen7Data flag
  - SwimmingEvent: { Heats: Map<number, Heat>, EventTitle, Records, HasGen7Data }
  - Meet: { MeetTitle, Events: Map<number, SwimmingEvent>, RecordTags, HasGen7Data }
  - ScoreboardDigitEnhanced: { value, decPoint, segmentMapped, updated }
  - ScoreboardModuleEnhanced: { univ, horn, moduleData[31] }
  - EnhancedScoreboard: { boardData[31], BlankState logic }
- Implement mapping / remapping algorithm:
  - Initialize a 32-entry _mappings array from concatenated hex strings as in C# static constructor.
  - Implement rotateLeft32/rotateRight32 and getLowest7F helpers for 32-bit ops.
  - Keep a per-instance mapper state similar to C# for incoming stream and a static RemapByte overload that accepts state (for non-checksum remapping).
- Implement serial parsing state machine:
  - Buffer incoming bytes, detect packet start (byte with 0x80 bit).
  - Follow logic: waitingOnLength, inPacket, incomingData array, checksum calculation, then extract payload bytes remapped and feed ParseEnhancedByte.
- Implement ParseEnhancedByte similar to C#:
  - Maintain currentModule, dataByte1, currentDigit, inCommand, _inModuleCommand, moduleCommandData.
  - Update scbd[poolNumber].BoardData[module].ModuleData[digit] fields.
  - On module 12 parse event/heat digits and emit EventChange/HeatChange as needed.
  - Parse non-module commands (cmd id 18) to populate Gen7SwimmingData (MeetTitle, start list event/heat, swimmer names/teams) using UTF-8 decoding similar to SubStringUTF8 logic.
- Implement helpers:
  - DataToChar: map 0/15 to space, otherwise char from code.
  - GetDigit, GetTime, GetDigits, DecPointLit, ResetDotsLit and BlankState logic mapping using EnhancedScoreboard methods.
- Provide openPort and close methods; if portName invalid do not open.
- Expose minimal console demo method `printDemo()` that mirrors the selected C# console loop: prints Event/Heat, MeetTitle, EventTitle, and for modules 0..10 prints GetTime and swimmer name.
- Keep code synchronous where possible but serial read is event-driven.
- Comments: instruct to `npm install serialport` to operate.

*/

const { EventEmitter } = require('events');
const { SerialPort } = require('serialport');

// Helpers for 32-bit rotation and masks
function rotateLeft32(x, count) {
  count &= 31;
  return ((x << count) | (x >>> (32 - count))) >>> 0;
}
function rotateRight32(x, count) {
  count &= 31;
  return ((x >>> count) | (x << (32 - count))) >>> 0;
}
function getLowest7F(x) {
  return x & 0x7F;
}

// Data structures
class Lane {
  constructor(number) {
    this._number = number;
    this.LastName = '';
    this.FirstName = '';
    this.Team = '';
  }
  get Number() {
    return this._number;
  }
  set Number(v) {
    this._number = v;
  }
}

class Heat extends Array {
  constructor() {
    super();
    this.HasGen7Data = false;
    for (let i = 0; i < 12; ++i) this.push(new Lane(i + 1));
  }
}

class SwimmingEvent {
  constructor() {
    this.Heats = new Map();
    this.EventTitle = '';
    this.Records = new Array(4).fill('');
    this.HasGen7Data = false;
  }
}

class Meet {
  constructor() {
    this.MeetTitle = '';
    this.Events = new Map();
    this.RecordTags = new Array(4).fill('');
    this.HasGen7Data = false;
  }
}

class ScoreboardDigitEnhanced {
  constructor() {
    this.Value = 15;
    this._decPoint = false;
    this.SegmentMapped = false;
    this.Updated = false;
  }
  get DecPoint() {
    return this._decPoint;
  }
  set DecPoint(v) {
    this._decPoint = !!v;
  }
}

class ScoreboardModuleEnhanced {
  constructor() {
    this.Univ = false;
    this.Horn = false;
    this.ModuleData = new Array(31);
    for (let i = 0; i < 31; ++i) this.ModuleData[i] = new ScoreboardDigitEnhanced();
  }
  get Updated() {
    return this.ModuleData.some(d => d.Updated);
  }
}

const ScoreboardState = {
  None: 0,
  NotBlank: 1,
  BlankWithTime: 2,
  TotalBlank: 3,
  Reset: 4,
  Running: 5
};

const Sport = {
  SportLoader: 0,
  Swimming: 1
};

class EnhancedScoreboard {
  constructor() {
    this.BoardData = new Array(31);
    for (let i = 0; i < 31; ++i) this.BoardData[i] = new ScoreboardModuleEnhanced();
  }
  ShowingTimeOfDay() {
    return this.BoardData[22].ModuleData[5].Value !== 15 &&
           this.BoardData[22].ModuleData[6].Value !== 15 &&
           this.BoardData[22].ModuleData[5].Value !== 32 &&
           this.BoardData[22].ModuleData[6].Value !== 32;
  }
  IsBlanked() {
    for (let i = 1; i <= 10; ++i) {
      const val = this.BoardData[i].ModuleData[1].Value;
      if (val !== 15 && val !== 32) return false;
    }
    return true;
  }
  BlankState() {
    if (!this.IsBlanked()) return ScoreboardState.NotBlank;
    return this.ShowingTimeOfDay() ? ScoreboardState.BlankWithTime : ScoreboardState.TotalBlank;
  }
}

// gen7Scbd implementation
class Gen7Scbd extends EventEmitter {
  constructor(portName) {
    super();

    // mapping constants
    this._mappings = new Uint32Array(32);
    this._initMappings();

    // state
    this._moduleCommandData = [];
    this._currentScoreboardState = [];
    this._currentSport = [];
    this._inModuleCommand = false;
    this._isOdd = false;
    this._mapLength = 0;
    this._mapper = 0;
    this._mappingCount = 0;
    this.calculatedChecksum = 0;
    this.currentDigit = 0;
    this.currentModule = 0;
    this.dataByte1 = true;
    this.dataCount = 0;
    this.expecetdDataCount = 0;
    this.incomingData = new Uint8Array(256);
    this.incomingReadPtr = 0;
    this.incomingWritePtr = 0;
    this.inCommand = false;
    this.inPacket = false;
    this.judge1 = '';
    this.scbd = [new EnhancedScoreboard()];
    this._timerNumber = 0;
    this.waitingOnLength = false;
    this._startListEventNumber = 0;
    this._startListHeatNumber = 0;

    this.CurrentEventNumber = [];
    this.CurrentHeatNumber = [];
    this.CurrentSport = [];
    this.Gen7SwimmingData = [];

    // initialize for 1 pool, can support up to 4
    for (let i = 0; i < 1; ++i) {
      this.CurrentEventNumber.push(0);
      this.CurrentHeatNumber.push(0);
      this.CurrentSport.push(Sport.SportLoader);
      this._currentScoreboardState.push(ScoreboardState.None);
      this.Gen7SwimmingData.push(new Meet());
    }

    // serial port
    this.portName = portName;
    this.portOpen = false;
    this.port = null;

    if (portName && portName.toUpperCase().startsWith('COM')) {
      this.openPort();
    }
  }

  _initMappings() {
    const str = "F37C65B454BD061AC3E2161EEBB26E8EEC95883E5CAB118EF3D7D3ACC6DA3754" +
                "178C9A44414B16BC351AE48C30EA2D3839F009BCBC7F3AE4DECACED82AA0D794" +
                "7A02E6B088BA6B4EA63D2E4463E1780A574169B4D0258F42023E04D0D0D19CF6" +
                "FB0805F6E18DC550B61F577EC4FAEF9C9395C310EF23508067C46C28843F4A36";
    // parse into mappings
    for (let i = 0; i < 16; ++i) {
      const num = parseInt(str.substring(i * 8, i * 8 + 8), 16) >>> 0;
      this._mappings[i * 2 + 1] = num;
    }
    for (let i = 0; i < 16; ++i) {
      const num = parseInt(str.substring(128 + i * 8, 128 + i * 8 + 8), 16) >>> 0;
      this._mappings[i * 2] = num;
    }
  }

  openPort() {
    try {
        // Port settings should not be varied
      this.port = new SerialPort({
        path: this.portName,
        baudRate: 115200,
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        autoOpen: false
      });

      this.port.on('data', this._onData.bind(this));
      this.port.on('error', (err) => this.emit('error', err));

      this.port.open((err) => {
        if (err) {
          this.portOpen = false;
          this.emit('error', err);
          return;
        }
        this.portOpen = true;

        // Write initial sequence
        const buffer = Buffer.from([0x80, 0x1F, 15, 2]);
        this.port.write(buffer, (werr) => {
          if (werr) this.emit('error', werr);
        });
      });
      return true;
    } catch (ex) {
      this.emit('error', ex);
      return false;
    }
  }

  closePort() {
    if (this.port && this.port.isOpen) {
      this.port.close();
      this.portOpen = false;
    }
  }

  // Event wiring
  SetCurrentScorboardState(poolNumber, value) {
    const prev = this._currentScoreboardState[poolNumber];
    if (value !== prev) {
      if (value === ScoreboardState.Reset) {
        this.emit('ScoreboardReset', { poolNumber });
      } else if (value === ScoreboardState.Running && prev !== ScoreboardState.None) {
        this.emit('ScoreboardStart', { poolNumber });
      } else if (value === ScoreboardState.BlankWithTime) {
        this.emit('ScoreboardBlankWithTime', { poolNumber });
      } else if (value === ScoreboardState.TotalBlank) {
        this.emit('ScoreboardBlank', { poolNumber });
      }
    }
    this._currentScoreboardState[poolNumber] = value;
  }

  DecPointLit(poolNumber, module, digit) {
    if (poolNumber < this.scbd.length && module < this.scbd[poolNumber].BoardData.length) {
      const moduleData = this.scbd[poolNumber].BoardData[module].ModuleData;
      if (digit < moduleData.length) return !!moduleData[digit].DecPoint;
    }
    return false;
  }

  ResetDotsLit(poolNumber) {
    if (poolNumber < 0 || poolNumber >= 4) return false;
    for (let i = 1; i < 10; ++i) {
      if (this.scbd[poolNumber].BoardData[i].ModuleData[1].DecPoint) return true;
    }
    return !!this.scbd[poolNumber].BoardData[15].ModuleData[1].DecPoint;
  }

  // low-level data receive handler (serial 'data' event)
  _onData(buffer) {
    // buffer is a Node.js Buffer
    for (let i = 0; i < buffer.length; ++i) {
      const src1 = buffer[i];
      const num1 = this._remapByte(src1);
      if (this.inPacket) {
        if ((num1 & 0x80) !== 0) {
          this.incomingWritePtr = 0;
          this.incomingData[this.incomingWritePtr++] = num1;
          this.calculatedChecksum = num1;
          this.inPacket = false;
          this.waitingOnLength = true;
        } else {
          ++this.dataCount;
          if (this.dataCount > this.expecetdDataCount) {
            // finalize packet
            this.calculatedChecksum &= 0x7F;
            if ((this.calculatedChecksum & 0xFF) === num1) {
              // check for special header 159, 17|19
              if (this.incomingData[this.incomingReadPtr] === 159 &&
                 (this.incomingData[this.incomingReadPtr + 1] === 17 || this.incomingData[this.incomingReadPtr + 1] === 19)) {
                // remap payload using local MapState
                const poolNumber = (this.incomingData[this.incomingReadPtr + 2] - 1) & 0xFF;
                const src2 = (this.incomingData[this.incomingReadPtr + 3] | 0x80) & 0xFF;
                const byteList = [];
                const state = { MappingCount: 0, Mapper: 0, IsOdd: false, MapLength: 0 };
                const first = Gen7Scbd._remapByteStatic(src2, state);
                byteList.push(first);
                let num3 = first;
                for (let idx2 = 1; idx2 < this.dataCount - 4; ++idx2) {
                  const b = Gen7Scbd._remapByteStatic(this.incomingData[this.incomingReadPtr + 3 + idx2], state);
                  if (idx2 !== 1) byteList.push(b);
                  num3 = (num3 + b) & 0xFF;
                }
                const num5 = Gen7Scbd._remapByteStatic(this.incomingData[this.incomingReadPtr + this.dataCount - 1], state);
                if (((num3 & 0x7F) >>> 0) === num5) {
                  for (const inc of byteList) this.ParseEnhancedByte(inc, poolNumber);
                }
                this.incomingReadPtr = this.incomingWritePtr;
              }
              while (this.incomingReadPtr !== this.incomingWritePtr) {
                const b = this.incomingData[this.incomingReadPtr++];
                this.ParseEnhancedByte(b, 0);
              }
            } else {
              this.incomingReadPtr = this.incomingWritePtr = 0;
            }
            this.inPacket = false;
            this.waitingOnLength = false;
          } else {
            this.incomingData[this.incomingWritePtr++] = num1;
            this.calculatedChecksum = (this.calculatedChecksum + num1) & 0xFF;
          }
        }
      } else if (this.waitingOnLength) {
        this.waitingOnLength = false;
        this.inPacket = true;
        this.expecetdDataCount = num1;
        this.calculatedChecksum = (this.calculatedChecksum + num1) & 0xFF;
        this.dataCount = 0;
      } else if ((num1 & 0x80) !== 0) {
        this.incomingReadPtr = this.incomingWritePtr = 0;
        this.incomingData[this.incomingWritePtr++] = num1;
        this.calculatedChecksum = src1 & 0xFF; // original source used for checksum
        this.waitingOnLength = true;
      }
    }
  }

  // instance remap
  _remapByte(src) {
    let num1;
    if (src > 127) {
      this._mappingCount = 0;
      num1 = src;
      this._mapper = this._mappings[src & 31];
      this._isOdd = (src % 2) === 1;
    } else if (this._mappingCount === 0) {
      this._mapLength = (src ^ (this._mapper & 0x7F)) >>> 0;
      num1 = this._mapLength & 0xFF;
      ++this._mappingCount;
    } else {
      const num2 = !this._isOdd
        ? getLowest7F(rotateLeft32(this._mapper, (this._mapLength * this._mappingCount) & 0xFFFFFFFF))
        : getLowest7F(rotateRight32(this._mapper, (this._mapLength * this._mappingCount) & 0xFFFFFFFF));
      num1 = (src ^ num2) & 0xFF;
      ++this._mappingCount;
    }
    return num1;
  }

  // static remap used in payload decode 
  static _remapByteStatic(src, state) {
    let num1;
    if (src > 127) {
      state.MappingCount = 0;
      num1 = src;
      state.Mapper = this._staticMappings ? this._staticMappings[src & 31] : 0;
      // lazy init of staticMappings from prototype if not done
      if (!this._staticMappings) {
        this._staticMappings = new Uint32Array(32);
        // fill from same hex string used in constructor (duplicate here)
        const hex = "F37C65B454BD061AC3E2161EEBB26E8EEC95883E5CAB118EF3D7D3ACC6DA3754" +
                    "178C9A44414B16BC351AE48C30EA2D3839F009BCBC7F3AE4DECACED82AA0D794" +
                    "7A02E6B088BA6B4EA63D2E4463E1780A574169B4D0258F42023E04D0D0D19CF6" +
                    "FB0805F6E18DC550B61F577EC4FAEF9C9395C310EF23508067C46C28843F4A36";
        for (let i = 0; i < 16; ++i) this._staticMappings[i * 2 + 1] = parseInt(hex.substring(i * 8, i * 8 + 8), 16) >>> 0;
        for (let i = 0; i < 16; ++i) this._staticMappings[i * 2] = parseInt(hex.substring(128 + i * 8, 128 + i * 8 + 8), 16) >>> 0;
        state.Mapper = this._staticMappings[src & 31];
      }
      state.IsOdd = (src % 2) === 1;
    } else if (state.MappingCount === 0) {
      state.MapLength = (src ^ (state.Mapper & 0x7F)) >>> 0;
      num1 = state.MapLength & 0xFF;
      ++state.MappingCount;
    } else {
      const num2 = !state.IsOdd
        ? getLowest7F(rotateLeft32(state.Mapper, (state.MapLength * state.MappingCount) & 0xFFFFFFFF))
        : getLowest7F(rotateRight32(state.Mapper, (state.MapLength * state.MappingCount) & 0xFFFFFFFF));
      num1 = (src ^ num2) & 0xFF;
      ++state.MappingCount;
    }
    return num1;
  }

  // Parse a decoded enhanced byte
  ParseEnhancedByte(inc, poolNumber) {
    if ((inc & 0x80) === 0x80) {
      if (this.currentModule === 15) {
        if (this.ResetDotsLit(poolNumber) && this.CurrentSport[poolNumber] === Sport.Swimming) {
          this.SetCurrentScorboardState(poolNumber, ScoreboardState.Reset);
        } else {
          const scoreboardState = this.scbd[poolNumber].BlankState();
          if (scoreboardState === ScoreboardState.BlankWithTime || scoreboardState === ScoreboardState.TotalBlank) {
            this.SetCurrentScorboardState(poolNumber, scoreboardState);
          } else if (this.CurrentSport[poolNumber] === Sport.Swimming) {
            this.SetCurrentScorboardState(poolNumber, ScoreboardState.Running);
          }
        }
      } else if (this.currentModule >= 1 && this.currentModule <= 10) {
        if (this.currentModule === 1) this.DetectCurrentSport(poolNumber);
      } else if (this.currentModule === 12) {
        let num1 = 0;
        try {
          const digits = this.GetDigits(poolNumber, 12, 1, 3, -1, -1);
          num1 = digits !== '' ? parseInt(digits, 10) : 0;
        } catch { num1 = 0; }
        let num2 = 0;
        try {
          const digits = this.GetDigits(poolNumber, 12, 7, 3, -1, -1);
          num2 = digits !== '' ? parseInt(digits, 10) : 0;
        } catch { num2 = 0; }

        if (this.CurrentEventNumber[poolNumber] !== num1) {
          this.CurrentEventNumber[poolNumber] = num1;
          this.CurrentHeatNumber[poolNumber] = num2;
          if (this.CurrentEventNumber[poolNumber] !== 0 && this.CurrentHeatNumber[poolNumber] !== 0 && this.CurrentSport[poolNumber] === Sport.Swimming) {
            this.emit('EventChange', { poolNumber, eventNumber: num1, heatNumber: num2 });
          }
        } else if (this.CurrentHeatNumber[poolNumber] !== num2) {
          this.CurrentEventNumber[poolNumber] = num1;
          this.CurrentHeatNumber[poolNumber] = num2;
          if (this.CurrentEventNumber[poolNumber] !== 0 && this.CurrentHeatNumber[poolNumber] !== 0 && this.CurrentSport[poolNumber] === Sport.Swimming) {
            this.emit('HeatChange', { poolNumber, eventNumber: num1, heatNumber: num2 });
          }
        }
      } else if (this.currentModule === 31) {
        this.ParseNonModuleCommand(this._moduleCommandData);
      }
      this.currentModule = inc & 31;
      if (this.currentModule === 31) {
        this._inModuleCommand = true;
        this._moduleCommandData.length = 0;
      } else {
        if (this.currentModule < this.scbd[poolNumber].BoardData.length) {
          this.scbd[poolNumber].BoardData[this.currentModule].Univ = ((inc & 0x40) === 0x40);
          this.scbd[poolNumber].BoardData[this.currentModule].Horn = ((inc & 0x20) === 0x20);
        }
        this.dataByte1 = true;
        this.inCommand = false;
        this._inModuleCommand = false;
      }
    } else if (this._inModuleCommand) {
      this._moduleCommandData.push(inc);
    } else {
      if (this.inCommand) return;
      if (this.dataByte1) {
        this.currentDigit = inc & 31;
        if (this.currentModule < this.scbd[poolNumber].BoardData.length &&
            this.currentDigit < this.scbd[poolNumber].BoardData[this.currentModule].ModuleData.length) {
          this.scbd[poolNumber].BoardData[this.currentModule].ModuleData[this.currentDigit].DecPoint = ((inc & 0x40) === 0x40);
          this.scbd[poolNumber].BoardData[this.currentModule].ModuleData[this.currentDigit].SegmentMapped = ((inc & 0x20) === 0x20);
        }
        this.dataByte1 = false;
        if (this.currentDigit === 31) this.inCommand = true;
      } else {
        if (this.currentModule < this.scbd[poolNumber].BoardData.length &&
            this.currentDigit < this.scbd[poolNumber].BoardData[this.currentModule].ModuleData.length) {
          if (inc === 0) inc = 32;
          this.scbd[poolNumber].BoardData[this.currentModule].ModuleData[this.currentDigit].Value = inc & 0x7F;
        }
        this.dataByte1 = true;
      }
    }
  }

  // parse non-module command (cmd is array of bytes)
  ParseNonModuleCommand(cmd) {
    try {
      if (!cmd || cmd.length <= 1) return;
      const num1 = cmd[1];
      switch (cmd[0]) {
        case 8:
          if (cmd.length < 4 || cmd[2] !== 0x7F) break;
          // no-op in C# default
          break;
        case 18:
          if (cmd.length <= 2) break;
          switch (cmd[2]) {
            case 1: {
              const length1 = cmd[3];
              const text = this._subStringUTF8(cmd, 4, length1);
              this.Gen7SwimmingData[num1 - 1].MeetTitle = text;
              this.Gen7SwimmingData[num1 - 1].HasGen7Data = true;
              return;
            }
            case 2: {
              this._startListEventNumber = ((cmd[3] << 8) | cmd[4]) & 0xFFFF;
              this._startListHeatNumber = ((cmd[5] << 8) | cmd[6]) & 0xFFFF;
              const length2 = cmd[7];
              let swimmingEvent = this.Gen7SwimmingData[num1 - 1].Events.get(this._startListEventNumber);
              if (!swimmingEvent) {
                swimmingEvent = new SwimmingEvent();
                this.Gen7SwimmingData[num1 - 1].Events.set(this._startListEventNumber, swimmingEvent);
              }
              let heat = swimmingEvent.Heats.get(this._startListHeatNumber);
              if (!heat) {
                heat = new Heat();
                swimmingEvent.Heats.set(this._startListHeatNumber, heat);
              }
              swimmingEvent.EventTitle = this._subStringUTF8(cmd, 8, length2);
              return;
            }
            case 3: {
              const index = cmd[3];
              const length3 = cmd[4];
              const length4 = cmd[5];
              try {
                const lane = this.Gen7SwimmingData[num1 - 1].Events.get(this._startListEventNumber).Heats.get(this._startListHeatNumber)[index];
                lane.LastName = this._subStringUTF8(cmd, 7, length3);
                lane.Team = this._subStringUTF8(cmd, 7 + length3, length4);
                const hasData = Array.from(this.Gen7SwimmingData[num1 - 1].Events.get(this._startListEventNumber).Heats.get(this._startListHeatNumber))
                  .some(l => l.LastName && l.LastName.trim().length > 0);
                this.Gen7SwimmingData[num1 - 1].Events.get(this._startListEventNumber).Heats.get(this._startListHeatNumber).HasGen7Data = hasData;
                return;
              } catch {
                return;
              }
            }
            case 4: {
              try {
                const evt = this.Gen7SwimmingData[num1 - 1].Events.get(this._startListEventNumber);
                evt.HasGen7Data = Array.from(evt.Heats.values()).some(h => h.HasGen7Data);
                return;
              } catch {
                return;
              }
            }
            default:
              return;
          }
      }
    } catch (ex) {
      // swallow
    }
  }

  // UTF8 substring decoding that handles 0x7F escape for high bit
  _subStringUTF8(arr, startIndex, length) {
    if (startIndex < 0 || length < 0 || startIndex > arr.length - 1 || startIndex + length > arr.length) return '';
    const bytes = [];
    let i = startIndex;
    const end = startIndex + length;
    while (i < end) {
      let ch = arr[i++];
      if (ch === 0x7F) {
        // next byte OR 0x80
        const next = arr[i++] || 0;
        ch = (next | 0x80) & 0xFF;
      }
      bytes.push(ch);
    }
    return Buffer.from(bytes).toString('utf8').trim();
  }

  DetectCurrentSport(poolNumber) {
    this.CurrentSport[poolNumber] = Sport.Swimming;
  }

  DataToChar(data, spec) {
    if (data === 0 || data === 15) return ' ';
    return String.fromCharCode(data);
  }

  GetDigit(poolNumber, module, digit) {
    if (poolNumber < this.scbd.length && module < this.scbd[poolNumber].BoardData.length) {
      const moduleData = this.scbd[poolNumber].BoardData[module].ModuleData;
      if (digit < moduleData.length) return this.DataToChar(moduleData[digit].Value, false);
    }
    return ' ';
  }

  GetTime(poolNumber, module, startdigit, count, fillWithUniversal = true) {
    if (module > 30) return '';
    let sb = '';
    const module1 = (!fillWithUniversal || !this.scbd[poolNumber].BoardData[module].Univ) ? module : 0;
    for (let digit = startdigit; digit < startdigit + count; ++digit) {
      if (digit === startdigit + 2) {
        if (module === 0 || (this.DecPointLit(poolNumber, module, digit) && this.GetDigit(poolNumber, module1, digit - 1) !== ' '))
          sb += ':';
        sb += this.GetDigit(poolNumber, module1, digit);
      } else if (digit === startdigit + 3 && (this.DecPointLit(poolNumber, module, digit) || module === 0)) {
        sb += this.GetDigit(poolNumber, module1, digit);
        sb += '.';
      } else if (digit === startdigit + 1 && this.DecPointLit(poolNumber, module, digit)) {
        sb += this.GetDigit(poolNumber, module1, digit);
        sb += '.';
      } else {
        sb += this.GetDigit(poolNumber, module1, digit);
      }
    }
    return sb.trim();
  }

  GetDigits(poolNumber, module, startDigit, numDigits, decPointPos, colonPos) {
    if (module > 30 || startDigit + numDigits > 30) return '';
    const module1 = (!this.scbd[poolNumber].BoardData[module].Univ || startDigit <= 3 || startDigit >= 10) ? module : 0;
    if ((startDigit === 0 || startDigit === 2) && numDigits === 1) {
      return `${this.GetDigit(poolNumber, module1, startDigit)}${this.GetDigit(poolNumber, module1, startDigit + 1)}`.trim();
    }
    let sb = '';
    let digit = startDigit;
    for (let index = startDigit; index < startDigit + numDigits; ++index) {
      if (colonPos >= 0 && index === colonPos && this.DecPointLit(poolNumber, module, digit)) sb += ':';
      if (module1 < 25 || module1 > 30 || startDigit !== 0 || (index !== 0 && index !== 2)) {
        sb += this.GetDigit(poolNumber, module1, digit);
        if (decPointPos >= 0 && index === decPointPos && this.DecPointLit(poolNumber, module, digit)) sb += '.';
        if (digit === 1 && startDigit === 1) ++digit;
        ++digit;
      }
    }
    const out = sb.trim();
    return out === '.' ? '' : out;
  }

  // Demo console print scoreboard function showing all the module outputs commonly needed
  async printDemo(loopMs = 100) {
    // prints the same information: Event/Heat, MeetTitle, EventTitle and modules 0..10 times with swimmer info
    while (true) {
      console.clear();
      const gen7Scbdout = [];
      console.log(`Event ${this.CurrentEventNumber[0]} - Heat ${this.CurrentHeatNumber[0]}`);
      console.log(`Meet Title: ${this.Gen7SwimmingData[0] ? this.Gen7SwimmingData[0].MeetTitle : ''}`);

      let swmevt = null;
      const meet = (this.Gen7SwimmingData && this.Gen7SwimmingData.length > 0) ? this.Gen7SwimmingData[0] : null;
      if (meet && meet.HasGen7Data && this.CurrentEventNumber && this.CurrentEventNumber.length > 0) {
        const evt = this.CurrentEventNumber[0];
        if (evt > 0 && meet.Events && meet.Events.has(evt)) swmevt = meet.Events.get(evt);
      }
      let swmheat = null;
      if (swmevt && this.CurrentHeatNumber && this.CurrentHeatNumber.length > 0) {
        const heat = this.CurrentHeatNumber[0];
        if (heat > 0 && swmevt.Heats && swmevt.Heats.has(heat)) swmheat = swmevt.Heats.get(heat);
      }
      const EventTitle = swmevt ? swmevt.EventTitle : '';
      console.log(`Event Title: ${EventTitle}`);

      for (let indexmodule = 0; indexmodule <= 10; ++indexmodule) {
        let out = '';
        for (let indexdata = 0; indexdata <= this.scbd[0].BoardData[indexmodule].ModuleData.length - 1; ++indexdata) {
          out += Gen7Scbd.DataToChar(this.scbd[0].BoardData[indexmodule].ModuleData[indexdata].Value, false);
        }
        const lane = swmheat && indexmodule < swmheat.length ? swmheat[indexmodule] : null;
        const swimmerName = lane && (((lane.LastName || '').length + (lane.FirstName || '').length) > 0)
          ? `${lane.FirstName} ${lane.LastName} (${lane.Team})`
          : '';
        console.log(`GetTime Module:${indexmodule}: ${this.GetTime(0, indexmodule, 4, 30, true)}   SwimmerName: ${swimmerName}`);
      }

      await new Promise(r => setTimeout(r, loopMs));
    }
  }
}

module.exports = { Gen7Scbd, Lane, Heat, SwimmingEvent, Meet, EnhancedScoreboard, ScoreboardState, Sport };
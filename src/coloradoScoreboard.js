#!/usr/bin/env node

/*
 * MIT License
 * 
 * Copyright (c) 2018 Fabrizio Bertocci (fabriziobertocci@gmail.com)
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/* 
 * Notes:
 * This code is best seen with vim, using the following settings:
 * - set expandtab          " Use space instead of TAB
 * - set softtabstop=4      " 4 spaces for indentation
 * - set foldmethod=marker  " Use 'marker' for folding
 */

'use strict';

var fs = require('fs');
var path = require('path');
var SerialPort = require('serialport');
var http  = require('http');
var sprintf = require('sprintf-js').sprintf;

var isVerbose = false;
var dumpChannels = true;
var inputFileOffset = 0;

const DEFAULT_UART = "/dev/ttyUSB0";
const DEFAULT_UPDATE_MSEC = 1000;
const DEFAULT_HTTP_PORT = 8080;

const BLANK_CHAR = "&nbsp;";            // HTML doesn't render space as we expect...
const SPACE_ASCII = 0x20;
const ESCAPE_ASCII = String.fromCharCode(27);
const CONSOLE_CLEAR = ESCAPE_ASCII + "[2J";     // Requires an ANSI console
const CONSOLE_HOME  = ESCAPE_ASCII + "[0;0H";
const BLANK_EVENTHEAT = BLANK_CHAR + BLANK_CHAR + BLANK_CHAR;   // 3 blank chars
const BLANK_TIME = BLANK_CHAR + BLANK_CHAR + ":" + BLANK_CHAR + BLANK_CHAR + "." + BLANK_CHAR + BLANK_CHAR;
const BLANK_CLOCK = '00:00:00' + BLANK_CHAR + "AM";

/* This is the Javascript object that is sent to each client.
 * Those are the inital values.
 * The function updateScoreboard will copy the data from the physical scoreboard
 * representation (theDisplay) into this object, then send them to the clients
 * using socket.io
 */
var theScoreboard = {
    current_event: BLANK_EVENTHEAT,     // Fmt: XXX
    current_heat: BLANK_EVENTHEAT,      // Fmt: XXX
    current_time: "--:--",
    lane_number1: BLANK_CHAR,           // Fmt: X
    lane_number2: BLANK_CHAR,           // Fmt: X
    lane_number3: BLANK_CHAR,           // Fmt: X
    lane_number4: BLANK_CHAR,           // Fmt: X
    lane_number5: BLANK_CHAR,           // Fmt: X
    lane_number6: BLANK_CHAR,           // Fmt: X
    lane_place1: BLANK_CHAR,            // Fmt: X
    lane_place2: BLANK_CHAR,            // Fmt: X
    lane_place3: BLANK_CHAR,            // Fmt: X
    lane_place4: BLANK_CHAR,            // Fmt: X
    lane_place5: BLANK_CHAR,            // Fmt: X
    lane_place6: BLANK_CHAR,            // Fmt: X
    lane_time1: BLANK_TIME,             // Fmt: XX:XX.XX
    lane_time2: BLANK_TIME,             // Fmt: XX:XX.XX
    lane_time3: BLANK_TIME,             // Fmt: XX:XX.XX
    lane_time4: BLANK_TIME,             // Fmt: XX:XX.XX
    lane_time5: BLANK_TIME,             // Fmt: XX:XX.XX
    lane_time6: BLANK_TIME,             // Fmt: XX:XX.XX
    curr_time: BLANK_CLOCK,             // Fmt: "XX:XX:XX ??"
};

// An image map of each channel. theDisplay[x] is a channel and contains ASCII chars. 0=blank
var theDisplay = [];
// Note: Array(8) will create an array with 8 empty items, fill(x) will fill all the items with <x>
for (let i=0; i < 0x20; ++i) { theDisplay.push(Array(8).fill(SPACE_ASCII)); }

// {{{ usage
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
function usage() {
    console.log("coloradoScoreboard - Colorado Timing Systems Scoreboard");
    console.log("https://github.com/fabriziobertocci/coloradoScoreboard");
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
    console.log("");
    console.log("Usage: coloradoScoreboard.js [options]");
    console.log("Options are:");
    console.log("-h                  help - show this page");
    console.log("-v, --verbose       verbose");
    console.log("-q, --quiet         do not dump channels at each publication");
    console.log("-t, --test          test scoreboard (ignore all other args)");
    console.log("-d, --dev <dev>     UART device [default=%s]", DEFAULT_UART);
    console.log("-i, --in <file>     INPUT CTS data from <file> (will disable --dev)"); 
    console.log("--ioffset <file>    Offset from input file (requires --in)"); 
    console.log("-o, --out <file>    OUTPUT CTS data to <file>"); 
    console.log("-u, --update <msec> Update client rate in mSec [default=%d]", DEFAULT_UPDATE_MSEC); 
    console.log("-p, --port <num>    HTTP server listen port [default=%d]", DEFAULT_HTTP_PORT); 
}

// }}}
// {{{ getCurrTime
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Returns the current clock formatted for the curr_time variable
function getCurrTime() {
    var d = new Date();
    var hoursAmPm = (d.getHours() % 12);
    var amPm = (d.getHours() > 12) ? "PM" : "AM";
    hoursAmPm = (hoursAmPm != 0) ? hoursAmPm : 12;
    
    return hoursAmPm + ":" + 
           ("0" + d.getMinutes()).slice(-2) + ":" +
           ("0" + d.getSeconds()).slice(-2) + 
           BLANK_CHAR + amPm;
} 
// }}}
// {{{ testScoreboard
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
function testScoreboard(io) {
    var tt = 0;
    setInterval(()=> {
        var laneTime =  ((tt % 2) ? "&nbsp;&nbsp;:&nbsp;&nbsp;.&nbsp;&nbsp;" : "88:88.88");
        io.sockets.emit('update_scoreboard', {
            content_meet_title: ((tt % 2) ? "** TEST SCOREBOARD **" : "__ SCOREBOARD TEST __"),
            current_event: tt,
            current_heat: tt,
            lane_number1: tt,
            lane_number2: tt,
            lane_number3: tt,
            lane_number4: tt,
            lane_number5: tt,
            lane_number6: tt,
            lane_number7: tt,
            lane_place1: tt,
            lane_place2: tt,
            lane_place3: tt,
            lane_place4: tt,
            lane_place5: tt,
            lane_place6: tt,
            lane_place7: tt,
            lane_place8: tt,
            lane_time1: laneTime,
            lane_time2: laneTime,
            lane_time3: laneTime,
            lane_time4: laneTime,
            lane_time5: laneTime,
            lane_time6: laneTime,
            lane_time7: laneTime,
            lane_time8: laneTime,
            curr_time: getCurrTime(),
        });
        if (++tt == 10) tt = 0;
    }, 1000);

}

// }}}
// {{{ processByte
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
var theStreamState = {
    dataReadout: false,     // From bit #0 of control byte
    channel: 0,             // Obtained from control byte
};

function processByte(byteIn) {
    if (byteIn > 0x7f) {
        // It's a control byte, what is the next data?
        theStreamState.dataReadout = (byteIn & 1) == 0;    // bit #0 = 0 -> DATA is readout, 1=DATA is Format
        theStreamState.channel = ((byteIn >> 1) & 0x1f) ^ 0x1f;
        if (theStreamState.channel > theDisplay.length-1) {
            console.log("!! Warning: invalid channel = chan=%d, byteIn=0x%x", theStreamState.channel, byteIn);
            return;
        }
        if (byteIn > 190) {
            // Blank out the line
            for (let i = 0; i < 8; ++i) { theDisplay[theStreamState.channel][i] = SPACE_ASCII; }
        } else if (byteIn > 169 && byteIn < 190) {
            // Not clear here...
            /*
            if (theDisplay[theStreamState.channel][0] == SPACE_ASCII) {
                for (let i = 0; i < 8; ++i) { theDisplay[theStreamState.channel][i] = SPACE_ASCII; }
            }
            */
        }
    } else {
        // byteIn <= 0x7f: is a DATA byte
        if (theStreamState.dataReadout) {
            // Data Readout
            let segmentNum = (byteIn & 0xf0) >> 4;
            if (segmentNum >= 8) {
                console.log("!! Warning: segmentNum too large - byteIn = 0x%x", byteIn);
                return;
            }
            let segmentData = (byteIn & 0x0f); // before xor
            if ((theStreamState.channel > 0) && (segmentData == 0)) {
                // Blank the character
                segmentData = SPACE_ASCII;
            } else {
                segmentData = segmentData ^ 0x0f + 48; // 40 = 0x30 = ASCII '0'
            }
            theDisplay[theStreamState.channel][segmentNum] = segmentData;
        } 
        // else is a FORMAT byte, ignore it...
    }

}

// }}}
// {{{ updateScoreboard
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Translate 'theDisplay' into the 'theScoreboard' and push it to the clients
function updateScoreboard(io) {
    function getChar(chan, offset) {
        let ch = theDisplay[chan][offset];
        if ((ch == SPACE_ASCII) || (ch == 63)) {
            return BLANK_CHAR;
        } 
        return String.fromCharCode(ch);
    }
    function getLaneTime(chan) {
        return getChar(chan, 2) + getChar(chan, 3) + ':' +
               getChar(chan, 4) + getChar(chan, 5) + '.' +
               getChar(chan, 6) + getChar(chan, 7);
    }

    theScoreboard.current_event = getChar(0x0c, 0) + getChar(0x0c, 1) + getChar(0x0c, 2);
    theScoreboard.current_heat  = getChar(0x0c, 5) + getChar(0x0c, 6) + getChar(0x0c, 7);

    theScoreboard.lane_number1 = getChar(0x01, 0);
    theScoreboard.lane_number2 = getChar(0x02, 0);
    theScoreboard.lane_number3 = getChar(0x03, 0);
    theScoreboard.lane_number4 = getChar(0x04, 0);
    theScoreboard.lane_number5 = getChar(0x05, 0);
    theScoreboard.lane_number6 = getChar(0x06, 0);

    theScoreboard.lane_place1  = getChar(0x01, 1);
    theScoreboard.lane_place2  = getChar(0x02, 1);
    theScoreboard.lane_place3  = getChar(0x03, 1);
    theScoreboard.lane_place4  = getChar(0x04, 1);
    theScoreboard.lane_place5  = getChar(0x05, 1);
    theScoreboard.lane_place6  = getChar(0x06, 1);

    theScoreboard.lane_time1   = getLaneTime(0x01);
    theScoreboard.lane_time2   = getLaneTime(0x02);
    theScoreboard.lane_time3   = getLaneTime(0x03);
    theScoreboard.lane_time4   = getLaneTime(0x04);
    theScoreboard.lane_time5   = getLaneTime(0x05);
    theScoreboard.lane_time6   = getLaneTime(0x06);

    theScoreboard.sys_time    = "System Time: " + getCurrTime();
    theScoreboard.current_time = "Console Time: " + getChar(0x16, 2) + getChar(0x16, 3) + ":" + getChar(0x16, 4) + getChar(0x16, 5);


    // Run-time is obtained from scoreboard on channel #0
    // Format is
    //       01234567
    // #00: '  MMssd?'      // MM=Minutes, ss=seconds, d=1/10th of a second
    // #00: '  ???00?'      // System Stopped
    if (getChar(0, 5) == '0' && getChar(0, 6) == '0') {
        theScoreboard.run_time = "--:--.-";
    } else {
        theScoreboard.run_time = getChar(0, 2) + getChar(0, 3) + ":" + getChar(0, 4) + getChar(0, 5) + '.' + getChar(0, 6);
    }

    // console.log("-----------------------------");
    // console.log(JSON.stringify(theScoreboard));
    // console.log(JSON.stringify(theDisplay));
    if (dumpChannels) {
        process.stdout.write(CONSOLE_CLEAR + CONSOLE_HOME);
        for (let i=0; i < theDisplay.length; ++i) {
            console.log(sprintf("#%02x: '%s'", i, String.fromCharCode.apply(String, theDisplay[i])));
        }
        if (inputFileOffset) {
            console.log("OFF: " + inputFileOffset);
        }
    }

    io.sockets.emit('update_scoreboard', theScoreboard);
}

// }}}

// {{{ main
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// argv[0] = 'node'
// argv[1] = <full path to this script>
// argv[2] = <firstArgument>
// argv[3] = <secondArgument>

function main() {
    var ttyDevice = DEFAULT_UART;
    var updateMsec = DEFAULT_UPDATE_MSEC;
    var outFileName;
    var inFileName;
    var outFD;
    var inFD;
    var devFD;
    var httpPort = DEFAULT_HTTP_PORT;
    var argTestScoreboard = false;

    for (let i = 2; i < process.argv.length; ++i) {
        if ((process.argv[i] == "-q") || (process.argv[i] == "--quiet")) {
            dumpChannels = false;
            continue;
        }
        if ((process.argv[i] == "-v") || (process.argv[i] == "--verbose")) {
            isVerbose = true;
            continue;
        }
        if ((process.argv[i] == "-h") || (process.argv[i] == "--help")) {
            usage();
            process.exit(0);
        }
        if ((process.argv[i] == "-t") || (process.argv[i] == "--test")) {
            argTestScoreboard = true;
            break;
        }
        if ((process.argv[i] == "-p") || (process.argv[i] == "--port")) {
            if (i+1 >= process.argv.length) {
                console.log("Error: missing argument for --port parameter");
                process.exit(1);
            }
            httpPort = Number.parseInt(process.argv[++i]);
            if (httpPort < 1) {
                console.log("Error: value too small for --port parameter");
                process.exit(1);
            }
            continue;
        }
        if ((process.argv[i] == "-u") || (process.argv[i] == "--update")) {
            if (i+1 >= process.argv.length) {
                console.log("Error: missing argument for --update parameter");
                process.exit(1);
            }
            updateMsec = Number.parseInt(process.argv[++i]);
            if (updateMsec < 100) {
                console.log("Error: value too small for --update parameter");
                process.exit(1);
            }
            continue;
        }
        if ((process.argv[i] == "-d") || (process.argv[i] == "--dev")) {
            if (i+1 >= process.argv.length) {
                console.log("Error: missing argument for --dev parameter");
                process.exit(1);
            }
            ttyDevice = process.argv[++i];
            continue;
        }
        if ((process.argv[i] == "-o") || (process.argv[i] == "--out")) {
            if (i+1 >= process.argv.length) {
                console.log("Error: missing argument for --out parameter");
                process.exit(1);
            }
            outFileName = process.argv[++i];
            continue;
        }
        if ((process.argv[i] == '-i') || (process.argv[i] == "--in")) {
            if (i+1 >= process.argv.length) {
                console.log("Error: missing argument for --in parameter");
                process.exit(1);
            }
            inFileName = process.argv[++i];
            continue;
        }

        if (process.argv[i] == "--ioffset") {
            if (i+1 >= process.argv.length) {
                console.log("Error: missing argument for --ioffset parameter");
                process.exit(1);
            }
            inputFileOffset = Number.parseInt(process.argv[++i]);
            if (inputFileOffset < 0) {
                console.log("Error: invalid value for --ioffset parameter");
                process.exit(1);
            }
            continue;
        }

        console.log("Error: invalid argument: " + process.argv[i]);
        process.exit(1);
    }

    var server = http.createServer((req, res) => {
        if (isVerbose) console.log("\nHTTP REQ: " + req.url);
        if ((req.url.length == 0) || (req.url == "/")) {
            // Redirect
            req.url = "/index.html";
        }
        fs.readFile(__dirname + "/static/" + req.url, function(error, data) {
            if (error) {
                res.writeHead(404);
                res.end("Not found");
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data, 'utf-8');
            }
        });
    }).listen(httpPort);
    console.log('HTTP Server running at http://127.0.0.1:%d/', httpPort);

    if (outFileName) {
        if (isVerbose) console.log("Dumping CTS data to file: %s", outFileName);
        fs.open(outFileName, "w", (err, fd) => {
            if (err) {
                console.log("Error opening outFile '%s' for write: %s", outFileName, err);
                process.exit(-1);
            }
            outFD = fd;
        });
    }

    var io = require('socket.io').listen(server);

    if (argTestScoreboard) {
        testScoreboard(io);
        return;
    }

    if (inFileName) {
        if (isVerbose) console.log("Reading CTS Scoreboard data from file: " + inFileName);
        inFD = fs.openSync(inFileName, "r");
        if (!inFD) {
            console.log("Error opening input file '%s' for read: %s", outFileName, err);
            process.exit(-1);
        }
        if (inputFileOffset > 0 && isVerbose) console.log("Starting reading input file from offset: " + inputFileOffset);

    } else {
        if (isVerbose) console.log("Opening port: %s", ttyDevice);
        devFD = new SerialPort(ttyDevice, {
            baudRate: 9600,
            parity: "even"
        });
    }

    // Update the UI every second
    setInterval(()=> {
        updateScoreboard(io);
    }, updateMsec);

    var dataIn = false;
    if (inFD) {
        setInterval( () => {
            var data = new Uint8Array(1);
            if (fs.readSync(inFD, data, 0, 1, inputFileOffset) != 1) {
                console.log("Input data read error");
                process.exit(-1);
            }

            processByte(data[0]);
            ++inputFileOffset;
        }, 1);      // @9600 we receive approx 1 byte per millisecond

    } else if (devFD) {
        devFD.on('data', (data) => {
            if (isVerbose) {
                if (dataIn) {
                    console.log("Receiving data from CTS:")
                    dataIn = true;
                }
                process.stdout.write("*");
            }
            if (outFD) fs.write(outFD, data, (err, bytesWritten, buffer) => {
                if (err) {
                    console.log("Erorr writing to out file '%s': %s", outFileName, err);
                    process.exit(-1);
                }
            });
            for (let i = 0; i < data.length; ++i) {
                processByte(data[i]);
            }
        });
    }
}

main();

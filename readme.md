# coloradoScoreboard
Read, decodes and format a web page from the Colorado Timing Console using the protocol
for the scoreboard.  Supports legacy CTS protocol (Gen7 Legacy, Gen6 and earlier) or Gen7/WA-2 protocol (Gen7 Serial).

A simple node.js-based application that reads the serial data being sent from a Colorado Timing Console to the scoreboard. 
The app reads the data, decodes it and produces a web page that simulates a real scoreboard.

I built this app in a short time right before our local swim team had an important meeting at a new venue that have no scoreboard installed.

The following projects provided invaluable help to this work:

- [CTS_Scoreboard](https://github.com/STU940652/CTS_Scoreboard)
- [vCTS](https://github.com/hwbrill/vsCTS)
- [Marco](https://marcoscorner.walther-family.org/2015/07/colorado-timing-console-scoreboard-protocol/)


-----
## Hardware
To get the CTS serial stream, see as follows.  To get the Gen7/WA-2 serial stream see that section further below.

1) An RS-232 port, e.g. a USB to RS-232 cable. Any converter is fine (or if you have a board with a RS232, even better)

2) A mono 1/4" male to two female Y cable, e.g.:
   [Hosa YPP-111 1/4 inch TS to Dual 1/4 inch TSF Y Cable](https://www.amazon.com/dp/B000068O53?ref=yo_pop_ma_swf)
   (this one was recommended by [CTS_Scoreboard](https://github.com/STU940652/CTS_Scoreboard)). It's cheap and does a perfect job.

3) A male DB-9 connector. Plenty of choices here. I had a DB9 connector laying around I managed to reuse.
   
### Pinout
The Mono audio cable has two wires:
- The (-) ground (larger part of the connector) is the ground of the DB9 and need to be connected to GND pin (5) of DB9
- The (+) signal (the tip of the connector) is the TX line of the Colorado console, and need to be connected to the RX pin (2) of DB9

## Protocol
The CTS transmit using two methods:

- FAST: bps=9600, 8 bits, **EVEN parity**, 1 stop bit

- SLOW: bps=2400, 8 bits, **EVEN parity**, 1 stop bit

Speed can be configured in the console through the settings (Setup -> Scoreboard 
-> High Speed)

## Gen7/WA-2 serial stream
The data stream from a Gen7 Serial timer console via RS-485 is much different than the previous CTS RS-232 data streams from previous generation CTS timers.  The addition of this support was done rather hastily, so not all the command line features available for classic CTS function are supported in Gen7 mode.  It just runs and outputs to the scoreboard web page.
## Hardware
You can create your own RS-485 to USB serial cable using the following parts:
1) CONXALL/SWITCHCRAFT P/N 3280-4PG-315  Male plug end  https://www.switchcraft.com/multi-con-x-connectors-0-875-od/multiconx/
2) FTDI USB-RS485-WE-1800-BT  USB to RS-485 converter  https://ftdichip.com/products/usb-rs485-we-1800-bt/
## Pinout 
Wiring for the CTS Gen7 RS-485 socket to the FTDI USB-RS485-WE-1800-BT is as follows, unreferenced wires are trimmed and not used
        FTDI Wires     |   Female Plug Pins
        BLACK (GND)    ->  Pin 4
        Yellow (Data-) ->  Pin 3
        Orange (Data+) ->  Pin 2
       
Below is a ascii drawing of the CTS Gen7 female RS-485 socket pinout as viewed from the back of the timer console, you will be wiring the Male Plug to the correpsonding pins of the FEMALE socket when the male plug is properly keyed and latched into the socket.
 
   TOP OF PLUG   v is the orientation notch
     .---v---.
   /           \
 |    o 1   o 4  |
<                 >
 |    o 2   o 3  |
   \           /
     '-------'
 
----
## Application

### Dependencies
You need to have node.js installed. I tested the app running on a Raspberry PI
with Rasbian version [TODO] as well as on a Linux Mint 9 (64-bit).

The following libraries are also needed:

- [serialport](https://www.npmjs.com/package/serialport) for the UART communication
- [sprinf-js](https://www.npmjs.com/package/sprintf-js) for easy formatting of the string
- [socket.io](https://www.npmjs.com/package/socket.io) for websockets

If you get the project, you can install all the required dependencies with a simple:
`$ npm i`

NOTE: access to the serial port might require root-access. Either change the permissions
on your `/dev/ttySxxx` or run the app as root.

### Command-line
```
Usage: coloradoScoreboard.js [options]
Options are:
-h                  help - show this page
-v, --verbose       verbose
-q, --quiet         do not dump channels at each publication
-t, --test          test scoreboard (ignore all other args)
-d, --dev <dev>     UART device [default=/dev/ttyUSB0]
-i, --in <file>     INPUT CTS data from <file> (will disable --dev)
--ioffset <file>    Offset from input file (requires --in)
-o, --out <file>    OUTPUT CTS data to <file>
-u, --update <msec> Update client rate in mSec [default=1000]
-p, --port <num>    HTTP server listen port [default=8080]
-7, --gen7          use Gen7 scoreboard protocol (default is CTS async)
```

- You can either specify a UART device where to read the data from (`-d`) or a file (`-i`)

- When you specify a file, you can also specify the offset where to start reading the data from (`--ioffset`).

- If you read from a UART device you can use the `-o` parameter to create a binary dump file that can be replayed
later with the `-i` option.

- By default the app uses the console to create a physical representation of all the Colorado Scoreboard channels.
To avoid this functionality use the `-q` (`--quiet`) command-line option.

- If you instead prefer to see some more verbose messages on the console (like what is the app doing),
  use the `-v` (`--verbose`) argument.

- When Gen7 param is supplied, not all the command line features available for classic CTS function are supported in this mode.  It just runs and outputs to the scoreboard web page.

### Console Output
When you run without the `-q` option, your console will show all the scoreboard channels published by the console.
It is going to look like this:

```
#00: '  ???00?'
#01: '12  5636'
#02: '26 12878'
#03: '31  5143'
#04: '44 11950'
#05: '53  5953'
#06: '65 12166'
#07: '        '
#08: '        '
#09: '        '
#0a: '        '
#0b: '        '
#0c: ' 27    1'
#0d: '  0 0  0'
#0e: '261435  '
#0f: '12  5636'
#10: '        '
#11: '  0 0  0'
#12: '        '
#13: ' 0 0 0 0'
#14: ' 26    1'
#15: '   0   0'
#16: '   949  '
#17: '        '
#18: '        '
#19: '56361287'
#1a: '51431195'
#1b: '59531216'
#1c: '        '
#1d: '        '
#1e: '        '
#1f: '        '
OFF: 4155
```
The first numer is the channel number, followed by the scoreboard output for that channel.

For example, chanel #1 shows the lane #1:

- First character (`1`) is the lane number
- Second character (`2`) is the Place
- The rest of the characters (`  5636`) are the time expressed in MMSShh (minutes, second, hundredths). In this case: `00:56.36`

Refer to the [Colorado Scoreboard Config](https://drive.google.com/file/d/0BzTyI86tWFG5TWFhZEZlM3dpRXM/view) 
document for more info about the scoreboard channels.


### Webapp Output
The generated webapp produces a single, static page as follow:

![](https://github.com/fabriziobertocci/coloradoScoreboard/raw/master/docs/webScreenshot.png)

The current screenshots contains the following scoreboard channels:

1. Channel #0x0c: Event/Heat

2. Static Lane/Place/Time header

3. Channel #0x01: Lane 1 results

4. Channel #0x02: Lane 2 results

5. Channel #0x03: Lane 3 results

6. Channel #0x04: Lane 4 results

7. Channel #0x05: Lane 5 results

8. Channel #0x06: Lane 6 results

9. Channel #0x00: Race run time

Followed by three more rows:

1. Event name (set either from the html page or pushed from the server)

2. Console time: the clock as obtained from channel #0x16

3. System time: the clock of the host running the coloradoScoreboard.js application 
   (this can be used to see when the page was updated, but it might differ from
   the clock from the console, so it might be a bit confusing).

The page is composed by the file [src/static/index.html](https://github.com/fabriziobertocci/coloradoScoreboard/blob/master/src/static/index.html).
This file is essentially a variation to the index.html from the [CTS_Scoreboard](https://github.com/STU940652/CTS_Scoreboard)
project.


--------
## Description of the application
After parsing the command-line parameters, the application opens the serial port
and install a data listener callback function. The callback usually receives a
Uint8Array object containing more than a single byte (since the lower serial IO
library performs some buffering).

The data received is then unwrapped and processed byte-by-byte.

Alternatively if the application is invoked with the --in command-line argument,
it reads the data from a binary file and process it approximately at the same
speed as a normal UART receiving data at 9600bps (read one byte every 1 mSec).

In either case (input from UART or from a file), each received byte is processed
by the function `processByte`. 

The `processByte` simply decodes byte by byte and populate the channel display 
table `theDisplay` (global array of 32x8 characters).

Asynchronously to this decoding process, there is a periodic task invoked every
second (configurable through the `--update` parameter) that takes the characters
from the `theDisplay` rows and place them in the Javascript object `theScoreboard`
containing the data sent to the HTML page.

For example, the `theScoreboard.lane_place1` contains the position of the 
athlete on lane 1 and is taken from the display character at `theDisplay[1][1]`

### Testing the scoreboard
The application have a simple test scoreboard functionality you can invoke
with the `-t` option. If selected, all the other options will be ignored.

The test option simply sends some display data over the HTML page until you 
interrupt the process with CTRL+C.


### Testing with real data
To test the app, a sample data is included, recorded during a local swim meet
by running the app with the `--out` argument.

The file `samples/meet.bin` have the data of a race (young kids, 25 yard breathstoke).

* Race starts at around offset 2500
* First athlete completes the race at around offset 26000 (time=27.22)
* Second athlete arrives at around offset 29600 (time=30.69)
* Race completes shortly after the last athlete arrives (lane 1) at around 56000


Other samples available in the `samples` directory:

* `samples/blank.bin`: few seconds of data received when the console is set
  to have the scoreboard in BLANK mode (Scoreboard -> SCOREBOARD BLANK)

* `samples/totalBlank.bin`: few seconds of data received when the console is
  set to have the scoreboard in TOTAL BLANK mode (Scoreboard -> SCOREBOARD BLANK x2)


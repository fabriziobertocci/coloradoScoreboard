# coloradoScoreboard
Read, decodes and format a web page from the Colorado Timing Console using the protocol
for the scoreboard

A simple node.js-based application that reads the serial data being sent from a Colorado Timing Console to the scoreboard. 
The app reads the data, decodes it and produces a web page that simulates a real scoreboard.

I built this app in a short time right before our local swim team had an important meeting at a new venue that have no scoreboard installed.

The following projects provided invaluable help to this work:

- [CTS_Scoreboard](https://github.com/STU940652/CTS_Scoreboard)
- [vCTS](https://github.com/hwbrill/vsCTS)
- [Marco](https://marcoscorner.walther-family.org/2015/07/colorado-timing-console-scoreboard-protocol/)



## Hardware
To get the CTS serial stream, you need:

1) An RS-232 port, e.g. a USB to RS-232 cable. Any converter is fine (or if you have a board with a RS232, even better)

2) A mono 1/4" male to two female Y cable, e.g.:
   [Hosa YPP-111 1/4 inch TS to Dual 1/4 inch TSF Y Cable](https://www.amazon.com/dp/B000068O53?ref=yo_pop_ma_swf)
   (this one was recommended by [CTS_Scoreboard](https://github.com/STU940652/CTS_Scoreboard. It's cheap and does a perfect job.

3) A male DB-9 connector. Plenty of choices here. I had a DB9 connector laying around I managed to reuse.

   
### Pinout
The Mono audio cable has two wires:
- The (-) ground (larger part of the connector) is the ground of the DB9 and need to be connected to GND pin (5) of DB9
- The (+) signal (the tip of the connector) is the TX line of the Colorado console, and need to be connected to the RX pin (2) of DB9


## Protocol
The CTS transmit using two methods:

- FAST: bps=9600, 8 bits, **EVEN parity**, 1 stop bit

- SLOW: bps=????, 8 bits, **EVEN parity**, 1 stop bit

TODO




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
```

- You can either specify a UART device where to read the data from (`-d`) or a file (`-i`)

- When you specify a file, you can also specify the offset where to start reading the data from (`--ioffset`).

- If you read from a UART device you can use the `-o` parameter to create a binary dump file that can be replayed
later with the `-i` option.

- By default the app uses the console to create a physical representation of all the Colorado Scoreboard channels.
To avoid this functionality use the `-q` (`--quiet`) command-line option.

- If you instead prefer to see some more verbose messages on the console (like what is the app doing),
  use the `-v` (`--verbose`) argument.


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




# homebridge-LutronHW-rs232
Lutron HomeWorks rs232 plugin for homebridge: https://github.com/nfarina/homebridge
Note: This plugin communicates with Lutron controllers over rs-232 

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin by copying into your node_modules directory.
   (I haven't figured out how to make an installable package yet)
3. Update your configuration file. See the sample below.

# Configuration

The configuration maps the lutron address to a name. Buttons define the index to a name in homekit. Additional sections for fans and Sivoia shade controllers ("sivoias") can be included, similar to lights, with names mapped to addresses. Keypads are more complicated.

Keypads present all available buttons to Homekit. Homekit can trigger actions on press, double press, long press, and release of each button. Sivoias only trigger scenes. The percentage is converted to scene close, 1, 2, 3, open by 25% increments.

To be done: Windows and window shades

Configuration sample:

 ```
"platforms": [
    {
	"platform": "LutronHW-RS232",
	"name": "LutronHW",
	"path": "/dev/ttyUSB0",
	"rooms": [
	    {
	        "name": "Living Room",
		"lights": [
		    ["Bedroom", "01:02:03:04:05"],
		    ["Bathroom", "01:02:03:04:04"]
		],
		"keypads": [
		    ["Bedroom", "01:04:01:03:01", { "1": "onoff", "5": "dUp", "6": "dDn" } ],
		    ["Kitchen", "01:04:01:03:03", { "1": "onoff", "5": "dUp", "6": "dDn" } ],
		    ["4 Button Panel", "01:06:10",
		     {
		         "1": "Lights on",
		         "3": "Lights on Low",
	 	         "5": "Fan on",
			 "7": "Off"
	 	     }
		    ],
	    }
	]
    }
]
```


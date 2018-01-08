# homebridge-LutronHW-rs232
Lutron HomeWorks rs232 plugin for homebridge: https://github.com/nfarina/homebridge
Note: This plugin communicates with Lutron controllers over rs-232 

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-lutronHW
3. Update your configuration file. See the sample below.

# Configuration

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
		    ["Ceiling", "01:02:03:04:05"],
		    ["Lamp", "01:02:03:04:04"]
		],
	    }
	]
    }
]
```


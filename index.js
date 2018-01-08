// Accessory for controlling Lutron Homeworks Interactive via HomeKit

var inherits = require('util').inherits;
var SerialPort = require("serialport");
var Service, Characteristic;

// need to be global to be used in constructor

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerPlatform("homebridge-lutronHW-RS232", "LutronHW-RS232", LutronHWPlatform);
    
    
    function LutronHWPlatform(log, config, api) {
	var platform = this;

	// configuration
	this.log = log;
	this.config = config;
//      this.accessories = [];

	this.name = config['name'];
	this.path = config['path'];
        
	this.deviceMap = {};
	this.timeout = config.timeout || 1000;

	this.serialQueue = [];
	this.ready = true;
        
	this.serialPort = new SerialPort(this.path, {
            baudrate: 115200,
            parser: SerialPort.parsers.readline("\r"),
            autoOpen: true
        }); // this is the openImmediately flag [default is true]
	this.log.debug("Serial: " + this.path); 
	this.serialPort.on('open', function() {
            this.log.debug("Serial Port OPEN: ");
            while (this.serialQueue.length) {
		var cmd = this.serialQueue.shift();
		//this.log.debug("SendingQ: {"+cmd+"} " + this.serialQueue.length);
		this.sendCommand(cmd);
            }
	    
	}.bind(this) );
	
	this.serialPort.on('data', function(data) {
            if (data.length > 0) {
		var cmd = data.split(",");
		switch (["L232>", "DL", "KLS", "KBP", "KBR", "DBP", "DBR", "KBH", "KBDP"].indexOf(cmd[0].trim())) {
		case 0: // L232>
                    this.log.warn("Got Prompt");
                    this.sendCommand("PROMPTOFF");
                    break;
		    
		case 1: // DL - Dimmer Level Change
                    if (cmd.length != 3) {
			this.log.error("DL CMD - INVALID (" + data.length + " bytes): " + data);
                    } else {
			this.log.debug("DL CMD (" + data.length + " bytes): " + data);
			var dev = this.deviceMap[cmd[1].trim()];
			var brightness = cmd[2].trim();
			if (dev) {
			    if ((brightness > 0)) {
				if (brightness != dev.brightness) {
				    this.log.debug("+-- update brightness: " + dev.name + " - " + cmd[1] + " - " + cmd[2] + "("+ dev.brightness + ":" + dev.power + ")");
				    dev.brightness = brightness;
				    dev.lightbulbService.setCharacteristic(Characteristic.Brightness, brightness);
				}
				if (dev.power != true) {
				    this.log.debug("+-- update PowerOn: " + dev.name + " - " + dev.power + " - " + cmd[2] + "("+ dev.brightness + ")");
				    dev.power = true;
				    dev.lightbulbService.setCharacteristic(Characteristic.On, true);
				}
			    } else {
				if (dev.power || dev.brightness == -1) {
				    this.log.debug("+-- OFF: " + dev.name + " - " + cmd[1] + " - " + cmd[2] + "("+ dev.brightness + ") "+ dev.power);
				    dev.power = false;
				    dev.lightbulbService.setCharacteristic(Characteristic.On, false);
				}
			    }
			} else {
			    this.log.error("DL: NO DEVICE" + cmd[1] + "- " + cmd[2]);
			}
                    }
                    break;
		    
		case 2: // KLS - Keypad LED State
                    //this.log.debug("KLS: " + cmd[1] + " - " + cmd[2]);
                    break;
		    
		case 3: // KBP - Keypad Button Press
		case 4: // KBR - Keypad Button Release
		case 5: // DBP - Dimmer Button Press
		case 6: // DBR - Dimmer Button Release
		case 7: // KBH - Keypad Button Long Press
		case 8: // KBDP - Keypad Button Double Press
                    this.log.debug(cmd[0] + ": " + cmd[1] + " - " + cmd[2]);
                    var press = cmd[0];
                    var addr = cmd[1].trim();
                    var button = cmd[2].trim();
		    
                    break;
		    
		default:
                    this.log.warn("UNKNOWN CMD (" + data.length + " bytes): " + data);
		}
            }
	}.bind(this) );
    }
    
    LutronHWPlatform.prototype = {
        sendCommand: function(command, callback) {
            if (!this.serialPort.isOpen()) {
		this.log.debug("Opening serial port: ["+command+"]");
		this.serialPort.open(function (err) {
		    if (err) {
			this.log("Serial Open Error:" + err);
			if (callback) callback(0, err);
		    }
		}.bind(this));
            }
	    
            this.log.debug("Sending {"+command+"}");
	    
            this.serialPort.write(command + "\r", function(err) {
		if (err) this.log("Write error = " + err);
	    }.bind(this));
            this.serialPort.drain();
        },
        // Function invoked when homebridge tries to restore cached accessory.
        // Developer can configure accessory at here (like setup event handler).
        // Update current value.
        NOconfigureAccessory: function(accessory) {
            var platform = this;
            this.log.debug(accessory.displayName, "Configure Accessory");
            this.log.debug("+-> " + accessory.name);
        },
        reloadData: function(callback) {
            var foundAccessories = [];
            this.log.debug("Refreshing all device data");
            if (callback)
                callback(foundAccessories);
        },
        accessories: function(callback) {
            var foundBulbs = [];
            this.log.debug("Accessing all device data");
            if (this.config.rooms.length > 0) {
		this.log.debug("Rooms: " + this.config.rooms.length);
		for (var rmcfg of this.config.rooms) {
                    this.log.debug("Room: " + rmcfg.name);
		    if (rmcfg.lights.length > 0) {
 			for (var light in rmcfg.lights) {
			    var bulbConfig = [];
			    this.log.debug("Light: " + rmcfg.lights[light][0] + ", ID: " + rmcfg.lights[light][1]);
			    
			    bulbConfig.name = rmcfg.lights[light][0];
			    bulbConfig.id = rmcfg.lights[light][1];
			    bulbConfig.room = rmcfg.name;
			    var bulb = new LutronHWBulb(bulbConfig, this, this.log);
			    this.deviceMap["["+bulbConfig.id+"]"] = bulb;
			    this.serialQueue.push("RDL, [" + bulbConfig.id + "]");
			    foundBulbs.push(bulb);
			    
			}
		    }
		}
            }
            if (callback) {
                this.log.debug("Callback: " + callback);
                callback(foundBulbs);
            }
        }
	
    };
    // Custom Characteristics and service...
    
    function LutronHWBulb(bulbConfig, controller, log) {
	this.log = log;
	this.controller = controller;
	
	this.name = bulbConfig.name;
	this.room = bulbConfig.room;
	this.id = bulbConfig.id;
	this.power = false;
	this.brightness = -1;
    }
    
    LutronHWBulb.prototype.setPowerState = function(powerOn, callback) {
	if (this.brightness < 0) {
	    this.brightness = 75;
	}
	
	if (powerOn != this.power) {  // only send an update if power is not already off
	    this.log.debug("setPowerState " + this.name + ": " + this.power + " -> " + powerOn);
	    this.controller.sendCommand("FADEDIM, " + (powerOn ? this.brightness : 0) + ", 0, 0, [" + this.id + "]");
	    this.power = powerOn;
	}
	
	callback(null);
    }
    
    LutronHWBulb.prototype.getPowerState = function(callback) {
	this.log.debug("Get Power of " + this.name + ": " + this.power);
	callback(null, this.power)
    }
    
    LutronHWBulb.prototype.setBrightness = function(level, callback) {
	
	// send to Lutron system only if it is a change
	if (this.brightness != level) {    
	    this.log.debug("setBrightness " + this.name + ": " + this.brightness + " -> " + level);
	    this.controller.sendCommand("FADEDIM, " + level + ", 0, 0, [" + this.id + "]");
	}
	
	// save last "on" value to toggle back on
	if (level > 0) {
	    this.brightness = level;
	}
	
	callback(null);
    }
    
    LutronHWBulb.prototype.getBrightness = function(callback) {
	this.log.debug("Get Brightness of " + this.name + ": " + this.brightness);
	if (this.brightness == -1) {
	    this.brightness = 50;
	}
	callback(null, this.brightness)
    }
    
    LutronHWBulb.prototype.setName = function(name, callback) {
	this.log.debug("Set Name of " + this.name + ": " + name);
	callback(null);
    }
    
    LutronHWBulb.prototype.identify = function(callback) {
	this.log.debug("Identify: " + this.name + ", " + this.id);
	callback(null);
    }
    
    LutronHWBulb.prototype.getServices = function() {
	this.informationService = new Service.AccessoryInformation();
	this.informationService
	    .setCharacteristic(Characteristic.Manufacturer, "Lutron")
	    .setCharacteristic(Characteristic.Model, "dimmer")
	    .setCharacteristic(Characteristic.SerialNumber, this.id);
	
	this.lightbulbService = new Service.Lightbulb(this.name);
	
	this.lightbulbService
	    .getCharacteristic(Characteristic.On)
            .on("set", this.setPowerState.bind(this))
            .on("get", this.getPowerState.bind(this));
	
	this.lightbulbService
	    .addCharacteristic(new Characteristic.Brightness())
            .on("set", this.setBrightness.bind(this))
            .on("get", this.getBrightness.bind(this));
	
	this.lightbulbService
	    .getCharacteristic(Characteristic.Name)
            .on("set", this.setName.bind(this))
            .on("get", this.setName.bind(this));
	return [this.informationService, this.lightbulbService];
    }
    
}

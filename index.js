// Accessory for controlling Lutron Homeworks Interactive via HomeKit

var inherits = require('util').inherits;
const SerialPort = require("serialport");
const Readline = SerialPort.parsers.Readline;
const Delimiter = SerialPort.parsers.Delimiter;

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
	this.keypadMap = {};
	this.keyLEDStates = {};
	this.timeout = config.timeout || 1000;

	this.serialQueue = [];
	this.ready = true;
        
	this.serialPort = new SerialPort(this.path, {
            baudRate: 115200,
	    autoOpen: true,
            //parser: new Readline({ delimiter: '\r'}),
        }); // this is the openImmediately flag [default is true]

	this.parser = new Readline({ delimiter: '\r' });
	this.serialPort.pipe(this.parser);
	
	this.log.debug("Serial: " + this.path);
	//this.serialPort.open(function (err) {
	//    if (err) {
	//	return console.log('Error opening port: ', err.message)
	//   }
	//    console.log("Serial port open!");
	//})
	this.serialPort.on('open', function() {
            this.log.debug("Serial Port OPEN: ");
            while (this.serialQueue.length) {
		var cmd = this.serialQueue.shift();
		this.log.debug("SendingQ: {"+cmd+"} " + this.serialQueue.length);
		this.sendCommand(cmd);
            }
	    
	}.bind(this) );
	
	this.parser.on('data', function(data) {
	    this.log.debug("Read data: "+data);
            if (data.length > 0) {
		var cmd = data.toString().split(/\s*[\ ,]\s*/);

		switch (cmd[0].trim()) {
		case "L232>": // L232>
                    this.log.warn("Got Prompt");
                    this.sendCommand("PROMPTOFF");
                    break;
		    
		case "DL": // DL - Dimmer Level Change: DL, <address>, <level>
                    if (cmd.length != 3) {
			this.log.error("DL CMD - INVALID (" + data.length + " bytes): " + data);
                    } else {
			this.log.debug("DL CMD (" + data.length + " bytes): " + data);
			var dev = this.deviceMap[cmd[1].trim()];
			var new_level = cmd[2].trim();
			if (dev) {
			    if (dev instanceof LutronHWBulb) {
				if ((new_level > 0)) {
				    if (new_level != dev.brightness) {
					this.log.debug("+-- update brightness: " + dev.name + " - " + cmd[1] + " - " + cmd[2] + "("+ dev.brightness + ":" + dev.power + ")");
					dev.brightness = new_level;
					dev.lightbulbService.setCharacteristic(Characteristic.Brightness, new_level);
				    }
				    if (dev.power != true) {
					this.log.debug("+-- update PowerOn: " + dev.name + " - " + dev.power + " - " + cmd[2] + "("+ dev.brightness + ")");
					dev.power = true;
					dev.lightbulbService.setCharacteristic(Characteristic.On, true);
				    }
				} else {
				    if (dev.power || dev.brightness == -1) {
					this.log.debug("+-- Bulb OFF: " + dev.name + " - " + cmd[1] + " - " + cmd[2] + "("+ dev.brightness + ") "+ dev.power);
					dev.power = false;
					dev.lightbulbService.setCharacteristic(Characteristic.On, false);
				    }
				}
			    } else if (dev instanceof LutronHWFan) {
				if (new_level >0) { // turn fan on to speed
				    if (new_level != dev.speed) {
					this.log.debug("+-- update speed: " + dev.name + " - " + cmd[1] + " - " + cmd[2] + "("+ dev.speed + ":" + dev.active + ")");
					dev.speed = new_level;
					dev.fanService.setCharacteristic(Characteristic.RotationSpeed, new_level);
				    }
				    if (dev.active != true) {
					this.log.debug("+-- update Active: " + dev.name + " - " + dev.active + " -> " + cmd[2] + "("+ dev.speed + ")");
					dev.active = true;
					dev.fanService.setCharacteristic(Characteristic.Active, true);
					dev.fanService.setCharacteristic(Characteristic.On, true);
					dev.fanService.setCharacteristic(Characteristic.RotationSpeed, dev.speed);

				    }				    
				} else { // turn fan off
				    if (dev.active || dev.speed == -1) {
					this.log.debug("+-- Fan OFF: " + dev.name + " - " + cmd[1] + " - " + cmd[2] + "("+ dev.speed + ") "+ dev.active);
					dev.active = false;
					dev.fanService.setCharacteristic(Characteristic.RotationSpeed, 0);
					dev.fanService.setCharacteristic(Characteristic.Active, false);
					dev.fanService.setCharacteristic(Characteristic.On, false);
				    } else {
					this.log.debug("+-- Fan WTF: " + dev.name + " - " + cmd[1] + " - " + cmd[2] + "("+ dev.speed + ") "+ dev.active);
					dev.active = false;
					dev.fanService.setCharacteristic(Characteristic.RotationSpeed, 0);
					dev.fanService.setCharacteristic(Characteristic.Active, false);
					dev.fanService.setCharacteristic(Characteristic.On, false);
				    }
				}
			    } else { 
				this.log.debug("Not a bulb: "+dev.name);
			    }
			} else {
			    this.log.error("DL: UNKNOWN DEVICE" + cmd[1] + "- " + cmd[2]);
			}
                    }
                    break;
		    
		case "KLS": // KLS - Keypad LED State
                    if (cmd.length != 3) {
			this.log.error("KLS CMD - INVALID (" + data.length + " bytes): " + data);
                    } else {
			this.log.debug("KLS CMD (" + data.length + " bytes): " + data);
			this.keyLEDStates[cmd[1].trim()] = cmd[2].trim();
		    }
                    break;


		        // Multi-button keypads (23,24 dim up/down)
		case "KBP":  // KBP - Keypad Button Press
		case "KBR":  // KBR - Keypad Button Release
		case "KBH":  // 7: // KBH - Keypad Button Hold (Long Press)
		case "KBDT": // 8: // KBDP - Keypad Button Double Press (Tap)
		    
		    // Maestro retrofit dimmer switches
		    // three buttons:  1 = main, 5 = dim up, 6 = dim down
		case "DBP":  // 5: // DBP - Dimmer Button Press
		case "DBR":  // 6: // DBR - Dimmer Button Release
		case "DBH":  // DBH - Dimmer Button Hold
		case "DBDT": // 8: // DBDT - Dimmer Button Double Tap

		    // Both types of buttons work the same, as far as I can tell,
		    // so coding as if they were the same.
		    // cmd: 0 = "KBP", 1 = keypad/dimmer address, 2 = button
                    this.log.debug(cmd[0] + ": " + cmd[1] + " - " + cmd[2]);
                    var press = cmd[0];
                    var addr = cmd[1].trim();
                    var button = cmd[2].trim();

		    // OK. They differ.
		    // dimmers are simpler. They are just a light,
		    // and are hard-wired to turn that light on and off.
		    // They also send the button press so scenes can react,
		    // but the local light will always react.

		    // keypads are not associated with a load

		    // I still don't see how it matters for this part of the
		    // program, which will send the button press event to
		    // Siri. ProgrammableStatelessSwitches with multiple buttons
		    //
		    // in config.json {"buttons": {1,2,3,4,6,23,24}}

		    // Are dimmers not stateless?
		    // Keypads have led states, which could represent button state
		    // but I am not tackling that yet.

		    var kp = this.keypadMap[addr];
		    if (!kp) {
			this.log.warn("No keypad found for " + addr);
			break;
		    }

		    kp.handlePressEvent(press, button);
		    
                    break;

		case "SVS": //   9: // SVS
                    this.log.debug(cmd.join(">-<"));

		    if (cmd.length < 4) {
			this.log.warn("Invalid - too few parameters")
			break;
		    }
		    
		    var addr = cmd[1].trim();
		    var pos = cmd[2].trim();
		    var status = cmd[3].trim();

		    var hkpos = -1;
		    
		    // pos is 1, 2, 3, R, L, C, o, S
		    // Homekit wants 0-100%
		    //
		    // my scenes are programmed C=0,o=100,1=75%,2=50%,3=25%
		    //   not sure how to map R, L, S if I see them
		    // Anyway, process the scene to a percentage
		    switch (pos) {
		    case "C": // 0
			hkpos = 0;
			break;

		    case "3": // 25%
			hkpos = 25;
			break;

		    case "2": // 50%
			hkpos = 50;
			break;

		    case "1": // 75%
			hkpos = 75;
			break;

		    case "o": // open, 100%
			hkpos = 100;
			break;

		    default:
			this.log.debug("- Unknown position: " + pos);
		    }
		    
		    var dev = this.deviceMap[addr];
		    if (!dev) {
			this.log.warn("No device found for " + addr);
			break;
		    }

		    // validate type of device to be a shade?

		    if (status == "STOPPED") {
			if (dev.position != hkpos) {
			    this.log.debug("- Setting Position = " + hkpos);
			    dev.position = hkpos;
			    dev.windowCoverService.setCharacteristic(Characteristic.CurrentPosition, hkpos);
			} else {
			    this.log.debug("- Already at " + hkpos);
			}
		    } else {
			if (status != "MOVING") {
			    this.log.warn("Unexpected SVS Status: " + status);
			}

			if (dev.targetPosition != hkpos) {
			    this.log.debug("- Setting targetPosition = " + hkpos);
			    dev.targetPosition = hkpos;

			    // just in case, at startup
			    if (dev.position == -1) {
				dev.position = hkpos;
				dev.windowCoverService.setCharacteristic(Characteristic.CurrentPosition, hkpos);
			    }
			    
			    dev.windowCoverService.setCharacteristic(Characteristic.TargetPosition, hkpos);
			} else {
			    this.log.debug("- Already at " + hkpos);
			}
		    }
		    break;
	
		case "Vacation": //   9: // Vacation mode
		    // Vacation mode (recording|playing|disabled)
		    // as response to VMR VMP VMD VMS (status)
		    // set the state of a ... uh .. multistate button?
		    this.log.debug("[VACATION] (" + data.length + "bytes): " + data);
		    break;
		
		default:
                    this.log.warn("UNKNOWN CMD (" + data.length + " bytes): " + data);
		    
		}
	    }
	}.bind(this) );
    }
    
    LutronHWPlatform.prototype = {
        sendCommand: function(command, callback) {
           // if (!this.serialPort.isOpen()) {
	//	this.log.debug("Opening serial port: ["+command+"]");
	//	this.serialPort.open(function (err) {
	//	    if (err) {
	//		this.log("Serial Open Error:" + err);
	//		if (callback) callback(0, err);
	//	    }
	//	}.bind(this));
          //  }
	    
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
            var foundDevices = [];

	    var now = new Date();
	    var curTime = now.getHours() + ":" + now.getMinutes() + ":" + now.getSeconds();
	    var curDate = now.getMonth() + "/" + now.getDate() + "/" + now.getFullYear();
	    
	    this.log.debug("Setting Time to " + curTime + " on " + curDate);
	    this.serialQueue.push("ST, " + curTime);
	    this.serialQueue.push("SD, " + curDate);
	    this.serialQueue.push("VMS");
	    // var vaca = new LutronHWVacation();
	    // this.deviceMap["Vacation"] = vaca;
	    // foundDevices.push(vaca);
	    
            this.log.debug("Accessing all device data");
            if (this.config.rooms.length > 0) {
		this.log.debug("Rooms: " + this.config.rooms.length);
		for (var rmcfg of this.config.rooms) {
                    this.log.debug("Room: " + rmcfg.name);
		    
		    if (rmcfg.lights && rmcfg.lights.length > 0) {
 			for (var light in rmcfg.lights) {
			    var bulbConfig = [];
			    this.log.debug("Light: " + rmcfg.lights[light][0] + ", ID: " + rmcfg.lights[light][1]);
			    
			    bulbConfig.name = rmcfg.lights[light][0];
			    bulbConfig.id = rmcfg.lights[light][1];
			    bulbConfig.room = rmcfg.name;
			    var bulb = new LutronHWBulb(bulbConfig, this, this.log);
			    this.deviceMap["["+bulbConfig.id+"]"] = bulb;
			    this.serialQueue.push("RDL, [" + bulbConfig.id + "]");
			    foundDevices.push(bulb);
			    
			}
		    }

		    if (rmcfg.fans && rmcfg.fans.length > 0) {
 			for (var fan in rmcfg.fans) {
			    var fanConfig = [];
			    this.log.debug("Fan: " + rmcfg.fans[fan][0] + ", ID: " + rmcfg.fans[fan][1]);
			    
			    fanConfig.name = rmcfg.fans[fan][0];
			    fanConfig.id = rmcfg.fans[fan][1];
			    fanConfig.room = rmcfg.name;
			    var fanD = new LutronHWFan(fanConfig, this, this.log);
			    this.deviceMap["["+fanConfig.id+"]"] = fanD;
			    this.serialQueue.push("RDL, [" + fanConfig.id + "]");
			    foundDevices.push(fanD);
			    
			}
		    }

		    if (rmcfg.sivoias && rmcfg.sivoias.length > 0) {
 			for (var shade of rmcfg.sivoias) {
			    var shadeConfig = [];
			    this.log.debug("Shade: " + shade[0] + ", ID: " + shade[1]);
			    
			    shadeConfig.name = shade[0];
			    shadeConfig.id = shade[1];
			    shadeConfig.room = rmcfg.name;
			    var lShade = new LutronHWSivoia(shadeConfig, this, this.log);
			    this.deviceMap["["+shadeConfig.id+"]"] = lShade;
			    this.serialQueue.push("RSVS, [" + shadeConfig.id + "]");
			    foundDevices.push(lShade);
			    
			}
		    }

		    if (rmcfg.keypads && rmcfg.keypads.length > 0) {
			for (var kp of rmcfg.keypads) {
			    var kpConfig = {};
			    this.log.debug("Keypad: " + JSON.stringify(kp));
			    kpConfig.name = kp[0];
			    kpConfig.id = kp[1];
			    kpConfig.room = rmcfg.name;
			    kpConfig.buttons = kp[2];
			    this.log.debug("KEYPAD: " + kp[0] + ", " + kp[1] + "=" + kp[2]);
			    this.log.debug(JSON.stringify(kpConfig));
			    
			    var myKp = new LutronHWKeypad(kpConfig, this, this.log);
			    
			    this.keypadMap["["+kpConfig.id+"]"] = myKp;
			    foundDevices.push(myKp);
			}
		    }
		}
            }
            if (callback) {
                callback(foundDevices);
            }
        }
	
    };
    // Custom Characteristics and service...

    // function LutronHWVacation(controller, log) {
    // 	this.log = log;
    // 	this.controller = controller;

    // 	this.name = "Vacation";
    // 	this.id = "COW-69";
    // 	this.vacaState = -1;
    // }

    // LutronHWVacation.prototype.getVacaState = function(callback) {
    // 	this.log.debug("Get vaca state");
    // 	if (this.vacaState == -1) {  // uninitialized
	    
    // }

    // LutronHWVacation.prototype.getServices = function() {
    // 	this.informationService = new Service.AccessoryInformation();
    // 	this.informationService
    // 	    .setCharacteristic(Characteristic.Manufacturer, "Lutron")
    // 	    .setCharacteristic(Characteristic.Model, "VC-420-69")
    // 	    .setCharacteristic(Characteristic.SerialNumber, this.id);
	
    // 	this.lockMechService = new Service.LockMechanism(this.name);
	
    // 	this.lockMechService
    // 	    .getCharacteristic(Characteristic.LockCurrentState)
    //         .on("set", this.setVacaState.bind(this))
    //         .on("get", this.getVacaState.bind(this));

    // 	return [this.informationService, this.lockMechService];
    // }
    
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
	if (callback) callback(null);
    }
    
    LutronHWBulb.prototype.getName = function(callback) {
	this.log.debug("Get Name of " + this.name);
	if (callback) callback(this.name);
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
            .on("get", this.getName.bind(this));
	return [this.informationService, this.lightbulbService];
    }

    // ceiling fan
    function LutronHWFan(fanConfig, controller, log) {
	this.log = log;
	this.controller = controller;
	
	this.name = fanConfig.name;
	this.room = fanConfig.room;
	this.id = fanConfig.id;

	this.active = false;
	this.speed = -1;
    }
    
    LutronHWFan.prototype.setActiveState = function(newState, callback) {
	if (this.speed < 0) {
	    this.log.debug("setActiveState -1");
	    this.speed = 100;
	}
	
	if (newState != this.active) {  // only send an update if power is not already off
	    this.log.debug("setActiveState " + this.name + ": " + this.active + " -> " + newState);
	    this.controller.sendCommand("FADEDIM, " + (newState ? this.speed : 0) + ", 0, 0, [" + this.id + "]");
	    this.active = newState;
	}
	
	callback(null);
    }

    LutronHWFan.prototype.getActiveState = function(callback) {
	this.log.debug("Get active of " + this.name + ": " + this.active);
	callback(null, this.active)
    }
    
    LutronHWFan.prototype.setSpeed = function(level, callback) {
	
	// send to Lutron system only if it is a change
	if (this.speed != level) {    
	    this.log.debug("setSpeed " + this.name + ": " + this.speed + " -> " + level);
	    this.controller.sendCommand("FADEDIM, " + level + ", 0, 0, [" + this.id + "]");
	}
	
	// save last "on" value to toggle back on
	if (level > 0) {
	    this.speed = level;
	} else {
	    this.fanService.setCharacteristic(Characteristic.On, false);

	}
	
	callback(null);
    }
    
    LutronHWFan.prototype.getSpeed = function(callback) {
	this.log.debug("Get Speed of " + this.name + ": " + this.speed);
	if (this.speed == -1) {
	    this.speed = 100;
	}
	callback(null, this.speed)
    }
    
    LutronHWFan.prototype.setName = function(name, callback) {
	this.log.debug("Set Name of " + this.name + ": " + name);
	if (callback) callback(null);
    }
    
    LutronHWFan.prototype.getName = function(callback) {
	this.log.debug("Get Name of " + this.name);
	if (callback) callback(this.name);
    }
    
    LutronHWFan.prototype.identify = function(callback) {
	this.log.debug("Identify: " + this.name + ", " + this.id);
	callback(null);
    }
    
    LutronHWFan.prototype.getServices = function() {
	this.informationService = new Service.AccessoryInformation();
	this.informationService
	    .setCharacteristic(Characteristic.Manufacturer, "Lutron")
	    .setCharacteristic(Characteristic.Model, "fan control")
	    .setCharacteristic(Characteristic.SerialNumber, this.id);
	
	this.fanService = new Service.Fan(this.name);

	this.fanService
	    .getCharacteristic(Characteristic.Active)
            .on("set", this.setActiveState.bind(this))
            .on("get", this.getActiveState.bind(this));
	
	this.fanService
	    .addCharacteristic(new Characteristic.RotationSpeed())
            .on("set", this.setSpeed.bind(this))
            .on("get", this.getSpeed.bind(this));
	
	this.fanService
	    .getCharacteristic(Characteristic.Name)
            .on("set", this.setName.bind(this))
            .on("get", this.getName.bind(this));
	return [this.informationService, this.fanService];
    }


    

    // Sivoia Shade
    function LutronHWSivoia(shadeConfig, controller, log) {
	this.log = log;
	this.controller = controller;
	
	this.name = shadeConfig.name;
	this.room = shadeConfig.room;
	this.id = shadeConfig.id;
	this.position = 0;        // current position
	this.targetPosition = -1;  // target position
	this.positionState = Characteristic.PositionState.STOPPED;
    }

    LutronHWSivoia.prototype.getCurrentPosition = function(callback) {
	this.log.debug("Get current Position of " + this.name + ": " + this.position);
	callback(null, this.position);
    }

    LutronHWSivoia.prototype.getTargetPosition = function(callback) {
	this.log.debug("Get Target Position of " + this.name + ": " + this.targetPosition);
	callback(null, this.position);
    }

    LutronHWSivoia.prototype.setTargetPosition = function(pos, callback) {
	this.log.debug("Set Target Position of " + this.name + ": " + this.targetPosition + "-->" + pos);

	// Homekit sends %s, we want 0,25,50,75,100
	var HKtoSIVPOS = ["C", "3", "2", "1", "o"];
	var sivIdx = Math.round(pos / 25);
	this.log.debug("-- Mapped position to " + sivIdx);
	var sivpos = HKtoSIVPOS[sivIdx];
	
	if (this.targetPosition != pos) {
	    this.log.debug("-- Changing target position to " + pos + "(" + sivpos + ")");
	    this.targetPosition = pos;
	    // and set the scene
	    if (sivpos != "") {
		this.controller.sendCommand("SVSS, " + "[" + this.id + "], " + sivpos);
	    } else {
		this.log.warn("Invalid position mapping: " + pos);
	    }
	} else {
	    this.log.debug("-- Already at " + pos);
	}
	callback(null, this.targetPosition);
    }

    LutronHWSivoia.prototype.getPositionState = function(callback) {
	// 0, 1, 2 - DECREASING, INCREASING, STOPPED
	this.log.debug("Get PositionState of " + this.name + ": " + this.positionState);
	callback(null, this.positionState);
    }


		    
    
    LutronHWSivoia.prototype.getServices = function() {
	this.informationService = new Service.AccessoryInformation();
	this.informationService
	    .setCharacteristic(Characteristic.Manufacturer, "Lutron")
	    .setCharacteristic(Characteristic.Model, "sivoia")
	    .setCharacteristic(Characteristic.SerialNumber, this.id);
	this.windowCoverService = new Service.WindowCovering(this.name);
	this.windowCoverService
	    .getCharacteristic(Characteristic.CurrentPosition)
	    .on("get", this.getCurrentPosition.bind(this));
	this.windowCoverService
	    .getCharacteristic(Characteristic.PositionState)
	    .on("get", this.getPositionState.bind(this));
	this.windowCoverService
	    .getCharacteristic(Characteristic.TargetPosition)
	    .on("set", this.setTargetPosition.bind(this))
	    .on("get", this.getTargetPosition.bind(this));

	return [this.informationService, this.windowCoverService];
    }


    //
    // multibutton keypad
    //
    // 
    function LutronHWKeypad(kpConfig, controller, log) {
	this.log = log;
	this.controller = controller;

	this.log.debug("KEYPAD constructor: " + JSON.stringify(kpConfig));
	
	this.name = kpConfig.name;
	this.room = kpConfig.room;
	this.id   = kpConfig.id;
	this.buttons = kpConfig.buttons;
	this.buttonPress = {}; // Click, Double, Long (Press, DPress, Hold)
	                       // trigger on release
	this.buttonServices = {};
    }

    LutronHWKeypad.prototype.getServices = function() {
	var myServices = [];
	this.informationService = new Service.AccessoryInformation();
	this.informationService
	    .setCharacteristic(Characteristic.Manufacturer, "Lutron")
	    .setCharacteristic(Characteristic.Model, "keypad")
	    .setCharacteristic(Characteristic.Name, this.name)
	    .setCharacteristic(Characteristic.SerialNumber, this.id);

	myServices.push(this.informationService);

	this.buttonServices = {};
	this.log.debug("[GetSvcs] Keypad: " + this.name + this.buttons + " " + JSON.stringify(this.buttons));
	for (var i in this.buttons) {
	    var button = this.buttons[i];

	    this.log.debug("+--] " + i + " : " + button);
	    
	    this.buttonServices[i] = new Service.StatelessProgrammableSwitch(button, i);
 
	    //this.buttonServices[i].setCharacteristic(Characteristic.Name, button);
	    
	    var serviceLabel = new Characteristic.ServiceLabelIndex;
	    serviceLabel.value = i;
	    this.buttonServices[i].addCharacteristic(serviceLabel);
	    
	    myServices.push(this.buttonServices[i]);
	}

	// this.chokeOn(dick);
	
	return myServices;
    }

    LutronHWKeypad.prototype.handlePressEvent = function(press, button) {
	this.log.debug("HandlePress:"+this.id+", "+press+", "+button);
	switch(press) {
	case "DBP":
	case "KBP":
	    this.buttonPress[button] = Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
	    break;
	case "DBDT":
	case "KBDT":
	    this.buttonPress[button] = Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS;
	    break;
	case "DBH":
	case "KBH":
	    this.buttonPress[button] = Characteristic.ProgrammableSwitchEvent.LONG_PRESS;
	    break;
	case "DBR":
	case "KBR":
	    if (this.buttonPress[button] >=0 && this.buttonPress[button] <=2) {
		this.log.debug("- Setting ProgSwitchEvent to " + this.buttonPress[button]);
		if (this.buttonServices[button]) {
		    this.buttonServices[button].setCharacteristic(Characteristic.ProgrammableSwitchEvent, this.buttonPress[button]);
		} else {
		    this.log.warn("UNEXPECTED button press " + this.id + " - " + button);
		}
		
	    } else {
		this.log.warn("- Invalid button press: " + this.buttonPress[button]);
	    }
	    this.buttonPress[button] = -1; // reset for next time
	    break;

	    
	}
    }

    
    // Velux (i think) skylight controls on CCOs
    // - internally these are controlled by a phantom keypad that
    //   has buttons for Open, Close, and Stop on 3 channels:
    //   Window, Interior Shade, Exterior Shade
    // - in config file, specify the addresses for
    //   all 9 controls and generate KBP for each of them
    //   as needed to open and close the shades.
    // This one has 2 WindowCover and one Window characteristic
    // - I don't think I get status updates from the server, just
    //   button presses. I cannot tell if the windows are open
    //   or closed on startup. Since the other devices call that
    //   Phantom keypad, I can fortunately catch that in the KBP
    //   handler. I wonder if I get echoed my own presses.
    // - when created, it will have to be in the deviceMap for
    //   all 9 buttons.
    //   - should the device handle the command (KBP, SVS, etc)? with
    //     its own handler? Then KBP could map to a device, then call its
    //     handler to process the command arguments, so actual keypads
    //     vs. this complex controller.
    
    function LutronHWVelux(shadeConfig, controller, log) {
	this.log = log;
	this.controller = controller;
	
	this.name = shadeConfig.name;
	this.room = shadeConfig.room;
	this.id = shadeConfig.id;
	this.position = 0;        // current position
	this.targetPosition = -1;  // target position
	this.positionState = Characteristic.PositionState.STOPPED;
    }

    LutronHWVelux.prototype.getCurrentPosition = function(callback) {
	this.log.debug("Get current Position of " + this.name + ": " + this.position);
	callback(null, this.position);
    }

    LutronHWVelux.prototype.getTargetPosition = function(callback) {
	this.log.debug("Get Target Position of " + this.name + ": " + this.targetPosition);
	callback(null, this.position);
    }

    LutronHWVelux.prototype.setTargetPosition = function(pos, callback) {
	this.log.debug("Set Target Position of " + this.name + ": " + this.targetPosition + "-->" + pos);

	// Homekit sends %s, we want 0,25,50,75,100
	var HKtoSIVPOS = ["C", "3", "2", "1", "o"];
	var sivIdx = Math.round(pos / 25);
	this.log.debug("-- Mapped position to " + sivIdx);
	var sivpos = HKtoSIVPOS[sivIdx];
	
	if (this.targetPosition != pos) {
	    this.log.debug("-- Changing target position to " + pos + "(" + sivpos + ")");
	    this.targetPosition = pos;
	    // and set the scene
	    if (sivpos != "") {
		this.controller.sendCommand("SVSS, " + "[" + this.id + "], " + sivpos);
	    } else {
		this.log.warn("Invalid position mapping: " + pos);
	    }
	} else {
	    this.log.debug("-- Already at " + pos);
	}
	callback(null, this.targetPosition);
    }

    LutronHWVelux.prototype.getPositionState = function(callback) {
	// 0, 1, 2 - DECREASING, INCREASING, STOPPED
	this.log.debug("Get PositionState of " + this.name + ": " + this.positionState);
	callback(null, this.positionState);
    }


	    
    
    LutronHWVelux.prototype.getServices = function() {
	this.informationService = new Service.AccessoryInformation();
	this.informationService
	    .setCharacteristic(Characteristic.Manufacturer, "Lutron")
	    .setCharacteristic(Characteristic.Model, "sivoia")
	    .setCharacteristic(Characteristic.SerialNumber, this.id);
	this.windowCoverService = new Service.WindowCovering(this.name);
	this.windowCoverService
	    .getCharacteristic(Characteristic.CurrentPosition)
	    .on("get", this.getCurrentPosition.bind(this));
	this.windowCoverService
	    .getCharacteristic(Characteristic.PositionState)
	    .on("get", this.getPositionState.bind(this));
	this.windowCoverService
	    .getCharacteristic(Characteristic.TargetPosition)
	    .on("set", this.setTargetPosition.bind(this))
	    .on("get", this.getTargetPosition.bind(this));
	
	return [this.informationService, this.windowCoverService];
    }
}


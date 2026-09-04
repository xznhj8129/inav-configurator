'use strict';

import FC from './fc';
import BitHelper from './bitHelper';
import i18n from './localization';

const serialPortHelper = (function () {

    let publicScope = {},
        privateScope = {};

    privateScope.namesGenerated = false;

    // This is a list of all the rules for the serial ports as well as their names
    privateScope.rules = [
        {
            name: 'MSP',
            groups: ['data']
        },
        {
            name: 'GPS',
            groups: ['sensors'],
            defaultBaud: 115200,
            isUnique: true
        },
        {
            name: 'TELEMETRY_FRSKY',
            groups: ['telemetry']
        },
        {
            name: 'TELEMETRY_HOTT',
            groups: ['telemetry']
        },
        {
            name: 'TELEMETRY_SMARTPORT',
            groups: ['telemetry']
        },
        {
            name: 'TELEMETRY_LTM',
            groups: ['telemetry']
        },
        {
            name: 'RX_SERIAL',
            groups: ['rx'],
            isUnique: true
        },
        {
            name: 'BLACKBOX',
            groups: ['peripherals']
        },
        {
            name: 'TELEMETRY_MAVLINK',
            groups: ['telemetry'],
        },
        {
            name: 'TELEMETRY_IBUS',
            groups: ['telemetry'],
        },
        {
            name: 'RANGEFINDER',
            groups: ['sensors'],
            isUnique: true
        },
        {
            name: 'GSM_SMS',
            groups: ['telemetry'],
        },
        {
            name: 'RUNCAM_DEVICE_CONTROL',
            groups: ['peripherals'],
        },
        {
            name: 'TBS_SMARTAUDIO',
            groups: ['peripherals'],
            isUnique: true
        },
        {
            name: 'IRC_TRAMP',
            groups: ['peripherals'],
            isUnique: true
        },
        {
            name: 'VTX_FFPV',
            groups: ['peripherals'],
            isUnique: true
        },
        {
            name: 'ESC',
            groups: ['peripherals'],
            defaultBaud: 115200,
            isUnique: true
        },
        {
            name: 'OPFLOW',
            groups: ['sensors'],
            isUnique: true
        },
        {
            name: 'FRSKY_OSD',
            groups: ['peripherals'],
            defaultBaud: 250000,
            isUnique: true
        },
        {
            name: 'DJI_FPV',
            groups: ['peripherals'],
            defaultBaud: 115200,
            isUnique: true
        },
        {
            name: 'MSP_DISPLAYPORT',
            groups: ['peripherals'],
            isUnique: true
        },
        {
            name: 'SMARTPORT_MASTER',
            groups: ['peripherals'],
            defaultBaud: 57600
        },
        {
            name: 'SBUS_OUTPUT',
            groups: ['peripherals'],
            defaultBaud: 115200
        },
        {
            name: 'GIMBAL',
            groups: ['peripherals'],
            defaultBaud: 115200
        },
        {
            name: 'HEADTRACKER',
            groups: ['peripherals'],
            defaultBaud: 115200
        },
        {
            name: 'CRSF_SENSOR',
            groups: ['sensors'],
            defaultBaud: 420000,
            lockedBaud: true,
            isUnique: true
        }
    ];

    // This is a mapping of the function names to their IDs required by the firmware and MSP protocol
    privateScope.functionIDs = {
        'MSP': 0,
        'GPS': 1,
        'TELEMETRY_FRSKY': 2,
        'TELEMETRY_HOTT': 3,
        'TELEMETRY_LTM': 4, // LTM replaced MSP
        'TELEMETRY_SMARTPORT': 5,
        'RX_SERIAL': 6,
        'BLACKBOX': 7,
        'TELEMETRY_MAVLINK': 8,
        'TELEMETRY_IBUS': 9,
        'RUNCAM_DEVICE_CONTROL': 10,
        'TBS_SMARTAUDIO': 11,
        'IRC_TRAMP': 12,
        'OPFLOW': 14,
        'LOG': 15,
        'RANGEFINDER': 16,
        'VTX_FFPV': 17,
        'ESC': 18,
        'GSM_SMS': 19,
        'FRSKY_OSD': 20,
        'DJI_FPV': 21,
        'SBUS_OUTPUT': 22,
        'SMARTPORT_MASTER': 23,
        'CRSF_SENSOR': 24,
        'MSP_DISPLAYPORT': 25,
        'GIMBAL': 26,
        'HEADTRACKER': 27
    };

    privateScope.identifierToName = {
        0: 'UART1',
        1: 'UART2',
        2: 'UART3',
        3: 'UART4',
        4: 'UART5',
        5: 'UART6',
        6: 'UART7',
        7: 'UART8',
        20: 'USB VCP',
        30: 'SOFTSERIAL1',
        31: 'SOFTSERIAL2'
    };

    privateScope.bauds = {
        'SENSOR': [
            '9600',
            '19200',
            '38400',
            '57600',
            '115200',
            '230400'
        ],
        'MSP': [
            '2400',
            '4800',            
            '9600',
            '19200',
            '38400',
            '57600',
            '115200',
            '230400'
        ],
        'TELEMETRY': [
            'AUTO',
            '1200',
            '2400',
            '4800',
            '9600',
            '19200',
            '38400',
            '57600',
            '115200',
            '230400',
            '460800'
        ],
        'PERIPHERAL': [
            '19200',
            '38400',
            '57600',
            '115200',
            '230400',
            '250000'
        ]
    };

    // Each firmware serial function maps to exactly one conceptual category in
    // the Ports tab. TELEMETRY_MAVLINK is promoted out of 'telemetry' and gets
    // its own top-level function, because MAVLink is the one case where the
    // firmware legitimately wants two bits on one port: adding the receiver
    // role encodes as TELEMETRY_MAVLINK + RX_SERIAL.
    privateScope.groupToCategory = {
        'data': 'MSP',
        'rx': 'SERIAL_RX',
        'telemetry': 'TELEMETRY',
        'sensors': 'SENSOR',
        'peripherals': 'PERIPHERAL'
    };

    // Which of the four firmware baud fields the single visible baud dropdown
    // writes to, per category. Serial RX and None have no user-selectable baud.
    privateScope.categoryBaudField = {
        'MSP': 'msp_baudrate',
        'MAVLINK': 'telemetry_baudrate',
        'TELEMETRY': 'telemetry_baudrate',
        'SENSOR': 'sensors_baudrate',
        'PERIPHERAL': 'peripherals_baudrate'
    };

    privateScope.categoryBaudList = {
        'MSP': 'MSP',
        'MAVLINK': 'TELEMETRY',
        'TELEMETRY': 'TELEMETRY',
        'SENSOR': 'SENSOR',
        'PERIPHERAL': 'PERIPHERAL'
    };

    privateScope.generateNames = function () {
        if (privateScope.namesGenerated) {
            return;
        }

        for (var i = 0; i < privateScope.rules.length; i++) {
            privateScope.rules[i].displayName = i18n.getMessage('portsFunction_' + privateScope.rules[i].name);
        }

        privateScope.namesGenerated = true;
    };

    publicScope.getRules = function () {
        privateScope.generateNames();

        return privateScope.rules;
    };

    publicScope.getRuleByName = function (name) {
        for (var i = 0; i < privateScope.rules.length; i++) {
            if (privateScope.rules[i].name === name) {
                return privateScope.rules[i];
            }
        }

        return null;
    }

    /**
     * 
     * @param {array} functions 
     * @returns {number}
     */
    publicScope.functionsToMask = function (functions) {
        let mask = 0;
        for (let index = 0; index < functions.length; index++) {
            let key = functions[index];
            let bitIndex = privateScope.functionIDs[key];
            if (bitIndex >= 0) {
                mask = BitHelper.bit_set(mask, bitIndex);
            }
        }
        return mask;
    };

    /**
     * 
     * @param {number} mask 
     * @returns {array}
     */
    publicScope.maskToFunctions = function (mask) {
        let functions = [];

        let keys = Object.keys(privateScope.functionIDs);
        for (let index = 0; index < keys.length; index++) {
            let key = keys[index];
            let bit = privateScope.functionIDs[key];
            if (BitHelper.bit_check(mask, bit)) {
                functions.push(key);
            }
        }
        return functions;
    };

    publicScope.getPortName = function (identifier) {
        return privateScope.identifierToName[identifier];
    };

    publicScope.getPortIdentifiersForFunction = function (functionName) {
        let identifiers = [];

        for (let index = 0; index < FC.SERIAL_CONFIG.ports.length; index++) {
            let config = FC.SERIAL_CONFIG.ports[index];
            if (config.functions.indexOf(functionName) != -1) {
                identifiers.push(config.identifier);
            }
        }

        return identifiers;
    }

    publicScope.getPortList = function () {

        let list = [];

        for (let index = 0; index < FC.SERIAL_CONFIG.ports.length; index++) {
            let config = FC.SERIAL_CONFIG.ports[index];

            //exclude USB VCP port
            if (config.identifier == 20) {
                continue;
            }

            let port = {
                identifier: config.identifier,
                displayName: privateScope.identifierToName[config.identifier]
            };
            list.push(port);
        }
        return list;
    };

    publicScope.getBauds = function (functionName) {
        return privateScope.bauds[functionName];
    };

    publicScope.getPortByIdentifier = function (identifier) {
        for (let index = 0; index < FC.SERIAL_CONFIG.ports.length; index++) {
            let config = FC.SERIAL_CONFIG.ports[index];
            if (config.identifier == identifier) {
                return config;
            }
        }
        return null;
    };

    publicScope.clearByFunction = function (functionName) {
        for (let index = 0; index < FC.SERIAL_CONFIG.ports.length; index++) {
            let config = FC.SERIAL_CONFIG.ports[index];
            if (config.functions.indexOf(functionName) != -1) {
                config.functions = [];
            }
        }
    };

    publicScope.set = function(port, functionName, baudrate) {

        publicScope.clearByFunction(functionName);

        let config = publicScope.getPortByIdentifier(port);

        if (config) {

            config.functions = [functionName];

            //set baudrate
            //TODO add next entries as we progress
            if (functionName == 'MSP') {
                config.msp_baudrate = baudrate;
            } else if (functionName == 'GPS') {
                config.sensors_baudrate = baudrate;
            }
        }
    }

    // Functions the Ports tab offers, in dropdown order.
    publicScope.CATEGORIES = ['NONE', 'MSP', 'MAVLINK', 'SERIAL_RX', 'TELEMETRY', 'SENSOR', 'PERIPHERAL'];

    // Pseudo-type marking the port that carries the receiver role.
    publicScope.RECEIVER = 'RECEIVER';

    publicScope.getCategoryForFunction = function (functionName) {
        if (functionName === 'TELEMETRY_MAVLINK') {
            return 'MAVLINK';
        }

        const rule = publicScope.getRuleByName(functionName);
        if (!rule) {
            return null;
        }

        for (let index = 0; index < rule.groups.length; index++) {
            const category = privateScope.groupToCategory[rule.groups[index]];
            if (category) {
                return category;
            }
        }

        return null;
    };

    publicScope.getFunctionsForCategory = function (category) {
        return publicScope.getRules().filter(function (rule) {
            return publicScope.getCategoryForFunction(rule.name) === category;
        });
    };

    publicScope.getBaudFieldForCategory = function (category) {
        return privateScope.categoryBaudField[category] || null;
    };

    publicScope.getBaudsForCategory = function (category) {
        const key = privateScope.categoryBaudList[category];
        return key ? privateScope.bauds[key] : null;
    };

    /**
     * Firmware functions[] -> one conceptual UI state for the port.
     *
     * The only multi-function combination that survives is
     * TELEMETRY_MAVLINK + RX_SERIAL. Every other port carrying more than one
     * function is legacy shared-port configuration and decodes to None, so
     * saving the tab writes it back cleared.
     *
     * @param {object} serialPort entry from FC.SERIAL_CONFIG.ports
     * @returns {{identifier: number, function: string, type: string, baudrate: (string|number)}}
     */
    publicScope.decodeSerialPort = function (serialPort) {
        const functions = serialPort.functions || [];
        const decoded = {
            identifier: serialPort.identifier,
            function: 'NONE',
            type: '',
            baudrate: ''
        };

        if (functions.length === 1) {
            const functionName = functions[0];
            const category = publicScope.getCategoryForFunction(functionName);

            if (category === 'MSP' || category === 'MAVLINK') {
                decoded.function = category;
            } else if (category === 'SERIAL_RX') {
                decoded.function = category;
                decoded.type = publicScope.RECEIVER;
            } else if (category) {
                decoded.function = category;
                decoded.type = functionName;
            }
        } else if (functions.length === 2 &&
                   functions.indexOf('TELEMETRY_MAVLINK') !== -1 &&
                   functions.indexOf('RX_SERIAL') !== -1) {
            decoded.function = 'MAVLINK';
            decoded.type = publicScope.RECEIVER;
        }

        const baudField = publicScope.getBaudFieldForCategory(decoded.function);
        if (baudField) {
            decoded.baudrate = serialPort[baudField];
        }

        return decoded;
    };

    /**
     * Exact reverse of decodeSerialPort().
     *
     * Starts from the port's previous configuration so the baud fields that
     * this function does not own survive a trip through another function -
     * switching a GPS port to MAVLink and back keeps the sensor baud.
     *
     * @param {object} uiPort {identifier, function, type, baudrate}
     * @param {object} previousSerialPort the port's current firmware config
     * @returns {object} entry for FC.SERIAL_CONFIG.ports
     */
    publicScope.encodeSerialPort = function (uiPort, previousSerialPort) {
        const encoded = Object.assign({}, previousSerialPort, {
            identifier: uiPort.identifier,
            functions: []
        });

        switch (uiPort.function) {
            case 'MSP':
                encoded.functions = ['MSP'];
                break;
            case 'MAVLINK':
                encoded.functions = uiPort.type === publicScope.RECEIVER
                    ? ['TELEMETRY_MAVLINK', 'RX_SERIAL']
                    : ['TELEMETRY_MAVLINK'];
                break;
            case 'SERIAL_RX':
                encoded.functions = ['RX_SERIAL'];
                break;
            case 'TELEMETRY':
            case 'SENSOR':
            case 'PERIPHERAL':
                encoded.functions = uiPort.type ? [uiPort.type] : [];
                break;
            default:
                encoded.functions = [];
        }

        const baudField = publicScope.getBaudFieldForCategory(uiPort.function);
        if (baudField && uiPort.baudrate) {
            encoded[baudField] = uiPort.baudrate;
        }

        return encoded;
    };

    return publicScope;
})();

export default serialPortHelper;
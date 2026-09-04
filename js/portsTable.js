'use strict';

import mspHelper from './msp/MSPHelper';
import FC from './fc';
import GUI from './gui';
import i18n from './localization';
import serialPortHelper from './serialPortHelper';
import jBox from 'jbox';

/*
 * The serial port editor. Renders one row per port - Port / Function / Type /
 * Baudrate - into a table supplied by whichever tab hosts it, and translates
 * between that and FC.SERIAL_CONFIG.
 *
 * The host tab owns loading and saving; this module owns the rows and the
 * rules about what a valid port assignment is.
 */

const VCP_IDENTIFIER = 20;
const RECEIVER = serialPortHelper.RECEIVER;

// Cap on waiting for receiver_type/serialrx_provider before letting the host
// tab carry on without them.
const RECEIVER_SETTINGS_TIMEOUT = 2000;

const portsTable = {};

// One decoded {identifier, function, type, baudrate} per editable port. This
// array is the source of truth; the selects are rendered from it and every
// change handler writes back to it.
let uiPorts = [];
let previousPorts = {};
let mspWarningModal = null;
let receiverType = null;
let serialRxProvider = null;

/*
 * The Receiver tab owns which protocol the receiver speaks; this table only
 * says which port it is on. Both settings are read so a port assignment that
 * contradicts the configured provider can be caught on save.
 */
portsTable.loadReceiverSettings = function (done) {
    function readSetting(name) {
        return mspHelper.getSetting(name).then(function (setting) {
            if (setting && setting.setting && setting.setting.table && setting.setting.table.values) {
                return setting.setting.table.values[setting.value];
            }
            return null;
        });
    }

    // This runs inside the host tab's load chain, so it must always call back.
    // A settings response that never arrives would otherwise stall the whole
    // tab; losing the cross-tab check is the acceptable failure, a blank
    // Configuration page is not.
    let finished = false;
    function finish() {
        if (!finished) {
            finished = true;
            done();
        }
    }
    setTimeout(finish, RECEIVER_SETTINGS_TIMEOUT);

    Promise.all([readSetting('receiver_type'), readSetting('serialrx_provider')]).then(function (values) {
        receiverType = values[0];
        serialRxProvider = values[1];
    }).catch(function () {
        // An FC that cannot report these simply gets no cross-tab validation.
        receiverType = null;
        serialRxProvider = null;
    }).then(finish);
};

function receiverIsSerial() {
    return receiverType === 'SERIAL';
}

function receiverMustBeMavlink() {
    return receiverIsSerial() && serialRxProvider === 'MAVLINK';
}

function typeOptionsFor(category) {
    const none = { value: '', label: i18n.getMessage('portsTypeNone') };
    const receiver = { value: RECEIVER, label: i18n.getMessage('portsTypeReceiver') };

    switch (category) {
        case 'SERIAL_RX':
            return [receiver];
        case 'MAVLINK':
            // A MAVLink port without the receiver role still does something -
            // it is a GCS/telemetry link - so do not label it like "off".
            return [{ value: '', label: i18n.getMessage('portsTypeTelemetry') }, receiver];
        case 'TELEMETRY':
        case 'SENSOR':
        case 'PERIPHERAL':
            return serialPortHelper.getFunctionsForCategory(category).map(function (rule) {
                return { value: rule.name, label: rule.displayName };
            });
        default:
            return [none];
    }
}

function defaultTypeFor(category) {
    const options = typeOptionsFor(category);
    if (category === 'SERIAL_RX') {
        return RECEIVER;
    }
    if (category === 'TELEMETRY' || category === 'SENSOR' || category === 'PERIPHERAL') {
        return options.length ? options[0].value : '';
    }
    return '';
}

function defaultBaudFor(uiPort) {
    const rule = serialPortHelper.getRuleByName(uiPort.type);
    if (rule && typeof rule.defaultBaud !== 'undefined') {
        return String(rule.defaultBaud);
    }

    const baudField = serialPortHelper.getBaudFieldForCategory(uiPort.function);
    if (!baudField) {
        return '';
    }
    return baudField === 'telemetry_baudrate' ? 'AUTO' : '115200';
}

/* The receiver role is global: assigning it to a port takes it off any other. */
function claimReceiver(identifier) {
    uiPorts.forEach(function (uiPort) {
        if (uiPort.identifier === identifier || uiPort.type !== RECEIVER) {
            return;
        }

        if (uiPort.function === 'MAVLINK') {
            // A MAVLink port without the receiver role is still a valid
            // GCS/telemetry link, so only the role is taken away.
            uiPort.type = '';
        } else {
            // Serial RX exists only to carry the receiver.
            uiPort.function = 'NONE';
            uiPort.type = '';
            uiPort.baudrate = '';
        }
    });
}

function countMspPorts() {
    return uiPorts.filter(function (uiPort) {
        return uiPort.function === 'MSP';
    }).length;
}

function showMSPWarning() {
    if (!mspWarningModal) {
        mspWarningModal = new jBox('Modal', {
            width: 480,
            height: 200,
            closeButton: 'title',
            animation: false,
            title: i18n.getMessage('portsMspWarningTitle') || 'MSP Port Warning',
            content: '<p>' + i18n.getMessage('portsMSPWarning') + '</p>'
        });
    }
    mspWarningModal.open();
}

function renderRow($row, uiPort) {
    const $function = $row.find('select.port-function');
    const $type = $row.find('select.port-type');
    const $baud = $row.find('select.port-baud');

    $function.empty();
    serialPortHelper.CATEGORIES.forEach(function (category) {
        $function.append($('<option/>', { value: category, text: i18n.getMessage('portsCategory_' + category) }));
    });
    $function.val(uiPort.function);

    $type.empty();
    const typeOptions = typeOptionsFor(uiPort.function);
    typeOptions.forEach(function (option) {
        $type.append($('<option/>', { value: option.value, text: option.label }));
    });
    $type.val(uiPort.type);
    $type.prop('disabled', typeOptions.length < 2);

    $baud.empty();
    const bauds = serialPortHelper.getBaudsForCategory(uiPort.function);
    if (bauds) {
        // A function can pin a baud its category's list does not carry -
        // CRSF_SENSOR runs at 420000, which is not in the sensor list - so
        // offer the port's own value too rather than render a blank select.
        const options = bauds.slice();
        if (uiPort.baudrate && options.indexOf(String(uiPort.baudrate)) === -1) {
            options.push(String(uiPort.baudrate));
        }

        options.forEach(function (baud) {
            $baud.append($('<option/>', { value: baud, text: baud }));
        });
        $baud.val(uiPort.baudrate);
        const rule = serialPortHelper.getRuleByName(uiPort.type);
        $baud.prop('disabled', !!(rule && rule.lockedBaud));
    } else {
        $baud.append($('<option/>', { value: '', text: i18n.getMessage('portsTypeNone') }));
        $baud.val('');
        $baud.prop('disabled', true);
    }
}

function renderAll($table) {
    $table.find('.portConfiguration').each(function () {
        const $row = $(this);
        const uiPort = portByRow($row);
        if (uiPort) {
            renderRow($row, uiPort);
        }
    });
}

function portByRow($row) {
    const identifier = $row.data('identifier');
    return uiPorts.find(function (uiPort) {
        return uiPort.identifier === identifier;
    });
}

portsTable.render = function ($table) {
    const $body = $table.find('tbody').empty();

    uiPorts = [];
    previousPorts = {};

    FC.SERIAL_CONFIG.ports.forEach(function (serialPort) {
        // USB VCP keeps whatever the FC reports: it is the link this
        // configurator is talking over, so it is not editable here.
        if (serialPort.identifier === VCP_IDENTIFIER) {
            return;
        }

        previousPorts[serialPort.identifier] = serialPort;
        const uiPort = serialPortHelper.decodeSerialPort(serialPort);
        uiPorts.push(uiPort);

        const $row = $('<tr class="portConfiguration">' +
            '<td class="identifierCell"><span class="identifier"></span>' +
            '<span class="softSerialWarning" title="' + i18n.getMessage('softSerialWarning') + '">' +
            '<img src="./images/icons/cf_icon_armed_active.svg" height="12" width="12" /></span></td>' +
            '<td><select class="port-function"></select></td>' +
            '<td><select class="port-type"></select></td>' +
            '<td><select class="port-baud"></select></td>' +
            '</tr>');

        $row.data('identifier', serialPort.identifier);
        $row.find('.identifier').text(serialPortHelper.getPortName(serialPort.identifier));
        $row.find('.softSerialWarning').toggle(serialPort.identifier >= 30);

        renderRow($row, uiPort);
        $body.append($row);
    });

    $body.off('change.portsTable');
    $body.on('change.portsTable', 'select.port-function', function (e) {
        const uiPort = portByRow($(e.currentTarget).closest('tr'));
        const mspCountBefore = countMspPorts();

        uiPort.function = $(e.currentTarget).val();
        uiPort.type = defaultTypeFor(uiPort.function);
        uiPort.baudrate = defaultBaudFor(uiPort);

        if (uiPort.type === RECEIVER) {
            claimReceiver(uiPort.identifier);
        }

        if (uiPort.function === 'MSP' && mspCountBefore >= 2) {
            showMSPWarning();
        }

        portsTable.clearValidation($table);
        renderAll($table);
    });

    $body.on('change.portsTable', 'select.port-type', function (e) {
        const uiPort = portByRow($(e.currentTarget).closest('tr'));

        uiPort.type = $(e.currentTarget).val();

        // Only a real protocol subtype carries baud metadata. Toggling the
        // MAVLink receiver role is not a protocol change, so it must not throw
        // away the baud the user picked for the port.
        if (serialPortHelper.getRuleByName(uiPort.type)) {
            uiPort.baudrate = defaultBaudFor(uiPort);
        }

        if (uiPort.type === RECEIVER) {
            claimReceiver(uiPort.identifier);
        }

        portsTable.clearValidation($table);
        renderAll($table);
    });

    $body.on('change.portsTable', 'select.port-baud', function (e) {
        portByRow($(e.currentTarget).closest('tr')).baudrate = $(e.currentTarget).val();
    });

    if (countMspPorts() > 2) {
        showMSPWarning();
    }
};

portsTable.clearValidation = function ($table) {
    $table.find('.portConfiguration').removeClass('invalid');
};

/*
 * The receiver port has to agree with the provider set on the Receiver tab.
 * This cannot be fixed automatically - either the port or the provider is
 * wrong and only the user knows which - so the save is refused instead.
 */
portsTable.validate = function ($table) {
    portsTable.clearValidation($table);

    if (!receiverIsSerial()) {
        return null;
    }

    const receiverPort = uiPorts.find(function (uiPort) {
        return uiPort.type === RECEIVER;
    });
    if (!receiverPort) {
        return null;
    }

    const portName = serialPortHelper.getPortName(receiverPort.identifier);
    let message = null;

    if (receiverMustBeMavlink() && receiverPort.function !== 'MAVLINK') {
        message = i18n.getMessage('portsReceiverMismatchMavlink', [portName]);
    } else if (!receiverMustBeMavlink() && receiverPort.function === 'MAVLINK') {
        message = i18n.getMessage('portsReceiverMismatchSerialRx', [serialRxProvider, portName]);
    }

    if (!message) {
        return null;
    }

    $table.find('.portConfiguration').filter(function () {
        return $(this).data('identifier') === receiverPort.identifier;
    }).addClass('invalid');
    GUI.log(message);

    return message;
};

/* Write the edited ports back into FC.SERIAL_CONFIG, ready to be saved. */
portsTable.apply = function () {
    const vcpPorts = FC.SERIAL_CONFIG.ports.filter(function (serialPort) {
        return serialPort.identifier === VCP_IDENTIFIER;
    });

    FC.SERIAL_CONFIG.ports = vcpPorts.concat(uiPorts.map(function (uiPort) {
        return serialPortHelper.encodeSerialPort(uiPort, previousPorts[uiPort.identifier]);
    }));
};

portsTable.cleanup = function () {
    if (mspWarningModal) {
        mspWarningModal.destroy();
        mspWarningModal = null;
    }
};

export default portsTable;

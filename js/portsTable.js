'use strict';

import mspHelper from './msp/MSPHelper';
import FC from './fc';
import GUI from './gui';
import i18n from './localization';
import serialPortHelper from './serialPortHelper';
import jBox from 'jbox';

/*
 * The serial port editor. Renders one row per port - Port / Function / Type /
 * Baudrate, plus the Shared MSP pair - into a table supplied by whichever tab
 * hosts it, and translates between that and FC.SERIAL_CONFIG.
 *
 * The host tab owns loading and saving; this module owns the rows and the
 * rules about what a valid port assignment is.
 */

const VCP_IDENTIFIER = 20;

// Identifiers at or above this are soft serial, whose names are twice as long
// as a UART's and carry a warning icon.
const SOFTSERIAL_IDENTIFIER = 30;

// Slots offered by the parked MAVLink port option.
// const MAVLINK_PORTS = ['MAV1', 'MAV2', 'MAV3', 'MAV4'];
const RECEIVER = serialPortHelper.RECEIVER;

// What a port's MSP side starts at when sharing is switched on and the port
// has no stored msp_baudrate to fall back to.
const DEFAULT_MSP_BAUD = '115200';

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
            uiPort.sharedTelemetry = '';
        }
    });
}

function countMspPorts() {
    return uiPorts.filter(function (uiPort) {
        return uiPort.function === 'MSP' || sharesMsp(uiPort);
    }).length;
}

/*
 * Which MAVLink slot the port belongs to. Parked: the control works, but
 * encodeSerialPort() has no field to write it to, so it is not rendered.
 * The selection was held on the uiPort so it survived a re-render.
 */
// function renderMavlinkPortOption($row, uiPort) {
//     const $mavlinkPort = $row.find('select.port-mavlink-port');
//     const isMavlink = uiPort.function === 'MAVLINK';
//
//     $row.find('.port-option--mavlink-port').toggle(isMavlink);
//
//     $mavlinkPort.empty();
//     if (!isMavlink) {
//         return;
//     }
//
//     MAVLINK_PORTS.forEach(function (slot) {
//         $mavlinkPort.append($('<option/>', { value: slot, text: slot }));
//     });
//     $mavlinkPort.val(uiPort.mavlinkPort || MAVLINK_PORTS[0]);
// }

/* Sharing is a property of the telemetry protocol, so it does not survive a
 * change of function or of protocol. */
function clearSharedMsp(uiPort) {
    uiPort.sharedMsp = false;
    uiPort.mspBaudrate = '';
}

/* A telemetry port that yields to MSP while disarmed is an MSP port too. */
function sharesMsp(uiPort) {
    return uiPort.function === 'TELEMETRY' &&
        !!uiPort.sharedMsp && serialPortHelper.canShareMsp(uiPort.type);
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
        $baud.prop('disabled', Boolean(rule?.lockedBaud));

        // SRXL2 starts at 115200 and negotiates upwards, so a number would
        // mislead. The "auto" option keeps the stored rate as its value.
        if (rule?.negotiatedBaud) {
            $baud.append($('<option/>', { value: uiPort.baudrate, text: i18n.getMessage('portsBaudAuto') }));
            $baud.children().last().prop('selected', true);
            $baud.attr('title', i18n.getMessage('portsBaudFixedByProtocol'));
        } else {
            $baud.removeAttr('title');
        }
    } else {
        $baud.append($('<option/>', { value: '', text: i18n.getMessage('portsTypeNone') }));
        $baud.val('');
        $baud.prop('disabled', true);
    }

    renderOptions($row, uiPort);
}

/*
 * The Options column carries whatever extra settings the selected port type
 * offers, and stays empty when it offers none. Shared MSP applies to a
 * telemetry protocol whose firmware backend yields the port while disarmed;
 * its baud select follows the switch, since an unshared port has no second
 * link to configure. Shared telemetry applies to the serial receiver's port,
 * whose wire can also carry LTM or IBUS telemetry at the receiver's baud.
 */
function renderSharedTelemetryOption($row, uiPort) {
    const $telemetry = $row.find('select.port-shared-telemetry');
    const shareable = uiPort.function === 'SERIAL_RX';

    $row.find('.port-option--shared-telemetry').toggle(shareable);
    $telemetry.empty();
    if (!shareable) {
        return;
    }

    $telemetry.append($('<option/>', { value: '', text: i18n.getMessage('portsTypeNone') }));
    serialPortHelper.getReceiverShareableTelemetry().forEach(function (rule) {
        $telemetry.append($('<option/>', { value: rule.name, text: rule.displayName }));
    });
    $telemetry.val(uiPort.sharedTelemetry || '');
}

function renderOptions($row, uiPort) {
    const $shared = $row.find('input.port-shared-msp');
    const $mspBaud = $row.find('select.port-msp-baud');

    renderSharedTelemetryOption($row, uiPort);

    const shareable = uiPort.function === 'TELEMETRY' && serialPortHelper.canShareMsp(uiPort.type);
    const sharing = shareable && !!uiPort.sharedMsp;

    $shared.prop('checked', sharing);
    // The label and switch travel together - the switch is the label+span that
    // GUI.switchery() built around the input, so the option group is shown and
    // hidden as a unit.
    $row.find('.port-option--shared-msp').toggle(shareable);

    // renderMavlinkPortOption($row, uiPort);

    $mspBaud.empty().toggle(sharing);
    if (!sharing) {
        return;
    }

    // Same reasoning as the main baud select: a port may already carry a rate
    // the MSP list does not offer, and rendering it as the first option would
    // silently change the user's configuration.
    const options = serialPortHelper.getBaudsForCategory('MSP').slice();
    if (uiPort.mspBaudrate && options.indexOf(String(uiPort.mspBaudrate)) === -1) {
        options.push(String(uiPort.mspBaudrate));
    }

    options.forEach(function (baud) {
        $mspBaud.append($('<option/>', { value: baud, text: baud }));
    });
    $mspBaud.val(uiPort.mspBaudrate);
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
            '<td class="port-column identifierCell"><span class="identifier"></span>' +
            '<span class="softSerialWarning" title="' + i18n.getMessage('softSerialWarning') + '">' +
            '<img src="./images/icons/cf_icon_armed_active.svg" height="12" width="12" /></span></td>' +
            '<td class="function-column"><select class="port-function"></select></td>' +
            '<td class="type-column"><select class="port-type"></select></td>' +
            '<td class="baud-column"><select class="port-baud"></select></td>' +
            '<td class="options-column">' +
            '<span class="port-option port-option--shared-msp">' +
            '<span class="port-option__label">' + i18n.getMessage('portsColumnSharedMsp') + '</span>' +
            '<input type="checkbox" class="port-shared-msp toggle" />' +
            '<select class="port-msp-baud"></select></span>' +
            '<span class="port-option port-option--shared-telemetry">' +
            '<span class="port-option__label">' + i18n.getMessage('portsOptionSharedTelemetry') + '</span>' +
            '<select class="port-shared-telemetry"></select></span>' +
            // MAVLink slot selector - parked until there is something on the FC
            // to bind it to. Uncomment these three lines with the matching
            // blocks below to bring it back.
            // '<span class="port-option port-option--mavlink-port">' +
            // '<span class="port-option__label">' + i18n.getMessage('portsOptionMavlinkPort') + '</span>' +
            // '<select class="port-mavlink-port"></select></span>' +
            '</td>' +
            '</tr>');

        $row.data('identifier', serialPort.identifier);
        $row.find('.identifier').text(serialPortHelper.getPortName(serialPort.identifier));
        $row.find('.softSerialWarning').toggle(serialPort.identifier >= SOFTSERIAL_IDENTIFIER);

        renderRow($row, uiPort);
        $body.append($row);
    });

    // The Port column is the one fixed width that is set from the rendered rows
    // rather than from the worst case: which ports a board has does not change
    // while the tab is open, and most boards have no soft serial to make room
    // for.
    $table.toggleClass('has-softserial', uiPorts.some(function (uiPort) {
        return uiPort.identifier >= SOFTSERIAL_IDENTIFIER;
    }));

    GUI.switchery();

    $body.off('change.portsTable');
    $body.on('change.portsTable', 'select.port-function', function (e) {
        const uiPort = portByRow($(e.currentTarget).closest('tr'));
        const mspCountBefore = countMspPorts();

        uiPort.function = $(e.currentTarget).val();
        uiPort.type = defaultTypeFor(uiPort.function);
        uiPort.baudrate = defaultBaudFor(uiPort);
        clearSharedMsp(uiPort);
        uiPort.sharedTelemetry = '';

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

        if (!serialPortHelper.canShareMsp(uiPort.type)) {
            clearSharedMsp(uiPort);
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

    $body.on('change.portsTable', 'input.port-shared-msp', function (e) {
        const uiPort = portByRow($(e.currentTarget).closest('tr'));
        const mspCountBefore = countMspPorts();

        uiPort.sharedMsp = $(e.currentTarget).is(':checked');

        if (uiPort.sharedMsp) {
            // Fall back to the stored msp_baudrate before inventing one, so
            // re-enabling a share the user turned off returns the port to the
            // rate it already had.
            const stored = previousPorts[uiPort.identifier];
            uiPort.mspBaudrate = (stored && stored.msp_baudrate) || DEFAULT_MSP_BAUD;
        } else {
            uiPort.mspBaudrate = '';
        }

        if (uiPort.sharedMsp && mspCountBefore >= 2) {
            showMSPWarning();
        }

        portsTable.clearValidation($table);
        renderAll($table);
    });

    // $body.on('change.portsTable', 'select.port-mavlink-port', function (e) {
    //     portByRow($(e.currentTarget).closest('tr')).mavlinkPort = $(e.currentTarget).val();
    // });

    $body.on('change.portsTable', 'select.port-shared-telemetry', function (e) {
        portByRow($(e.currentTarget).closest('tr')).sharedTelemetry = $(e.currentTarget).val();
    });

    $body.on('change.portsTable', 'select.port-msp-baud', function (e) {
        portByRow($(e.currentTarget).closest('tr')).mspBaudrate = $(e.currentTarget).val();
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

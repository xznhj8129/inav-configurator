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

// MAVLink port slots: mavlink_port1_serial .. mavlink_port4_serial.
const MAVLINK_PORT_COUNT = 4;
const SERIAL_PORT_NONE = -1;
const RECEIVER = serialPortHelper.RECEIVER;
const RECEIVER_SECONDARY = serialPortHelper.RECEIVER_SECONDARY;

// What a port's MSP side starts at when sharing is switched on and the port
// has no stored msp_baudrate to fall back to.
const DEFAULT_MSP_BAUD = '115200';

// Cap on waiting for the receiver settings and MAVLink slot bindings before
// letting the host tab carry on without them. Only a lost reply should reach
// it: an MSP request that runs out of retries never calls back. Nine reads
// take over 2 s on SITL.
const SETTINGS_TIMEOUT = 10000;

const portsTable = {};

// One decoded {identifier, function, type, baudrate} per editable port. This
// array is the source of truth; the selects are rendered from it and every
// change handler writes back to it.
let uiPorts = [];
let previousPorts = {};
let mspWarningModal = null;
let receiverType = null;
let serialRxProvider = null;
let dualRxEnabled = false;
let receiverTypeSecondary = null;
let serialRxProviderSecondary = null;
// Serial port identifier bound to each MAVLink slot, or null on firmware that
// has no slot bindings (the picker is then hidden).
let mavlinkBindings = null;
let storedMavlinkBindings = null;

function resetSettings() {
    receiverType = null;
    serialRxProvider = null;
    dualRxEnabled = false;
    receiverTypeSecondary = null;
    serialRxProviderSecondary = null;
    mavlinkBindings = null;
    storedMavlinkBindings = null;
}

/*
 * The Receiver tab owns which protocol each receiver speaks; this table only
 * says which port it is on. Those settings are read so a port assignment that
 * contradicts the configured provider can be caught on save, together with the
 * MAVLink slot bindings.
 */
portsTable.loadSettings = function (done) {
    // Nothing from a previous visit, or a previous flight controller, carries over.
    resetSettings();

    function readSetting(name) {
        return mspHelper.getSetting(name).then(function (setting) {
            if (setting && setting.setting && setting.setting.table && setting.setting.table.values) {
                return setting.setting.table.values[setting.value];
            }
            return null;
        });
    }

    // A setting that cannot be read is unknown, which skips the check that
    // needs it; firmware without Dual RX or slot bindings simply lacks them.
    // No read can fail the batch, so one missing setting costs only its check.
    function readOptionalSetting(name) {
        return readSetting(name).catch(function () {
            return null;
        });
    }

    function readMavlinkBindings() {
        const reads = [];
        for (let slot = 0; slot < MAVLINK_PORT_COUNT; slot++) {
            reads.push(mspHelper.getSetting(mavlinkSlotSetting(slot)).then(function (setting) {
                return setting ? setting.value : null;
            }).catch(function () {
                return null;
            }));
        }
        return Promise.all(reads).then(function (values) {
            const supported = values.every(function (value) {
                return value !== null && value !== undefined;
            });
            return supported ? values.map(Number) : null;
        });
    }

    // This runs inside the host tab's load chain, so it must always call back.
    // A settings response that never arrives would otherwise stall the whole
    // tab; losing the cross-tab checks is the acceptable failure, a blank page
    // is not. Each value is kept as it arrives, so a late one costs only its
    // own check. Values that arrive after the tab has rendered are dropped, so
    // the table validates and saves exactly what it showed.
    let finished = false;
    const timer = setTimeout(function () {
        if (!finished) {
            GUI.log(i18n.getMessage('portsSettingsTimeout'));
            finish();
        }
    }, SETTINGS_TIMEOUT);
    function finish() {
        if (!finished) {
            finished = true;
            clearTimeout(timer);
            done();
        }
    }
    function keep(read, store) {
        return read.then(function (value) {
            if (!finished) {
                store(value);
            }
        });
    }

    Promise.all([
        keep(readOptionalSetting('receiver_type'), function (value) { receiverType = value; }),
        keep(readOptionalSetting('serialrx_provider'), function (value) { serialRxProvider = value; }),
        keep(mspHelper.getSetting('dual_rx_enabled').then(function (setting) {
            return !!(setting && setting.value);
        }).catch(function () {
            return false;
        }), function (value) { dualRxEnabled = value; }),
        keep(readOptionalSetting('receiver_type_rx2'), function (value) { receiverTypeSecondary = value; }),
        keep(readOptionalSetting('serialrx_provider_rx2'), function (value) { serialRxProviderSecondary = value; }),
        keep(readMavlinkBindings(), function (values) {
            storedMavlinkBindings = values;
            mavlinkBindings = values ? values.slice() : null;
        })
    ]).then(finish);
};

// What the Receiver tab says each receiver role speaks.
function receiverSettingsFor(type) {
    if (type === RECEIVER_SECONDARY) {
        return dualRxEnabled ? { type: receiverTypeSecondary, provider: serialRxProviderSecondary } : null;
    }
    return { type: receiverType, provider: serialRxProvider };
}

/*
 * The second receiver role is offered only while Dual RX is on. A port that
 * already carries it keeps the option, so it is shown as it is stored instead
 * of being rewritten as something else on save.
 */
function receiverOptionsFor(uiPort) {
    const options = [{ value: RECEIVER, label: i18n.getMessage('portsTypeReceiver') }];
    if (dualRxEnabled || (uiPort && uiPort.type === RECEIVER_SECONDARY)) {
        options.push({ value: RECEIVER_SECONDARY, label: i18n.getMessage('portsTypeReceiverSecondary') });
    }
    return options;
}

function typeOptionsFor(category, uiPort) {
    const none = { value: '', label: i18n.getMessage('portsTypeNone') };

    switch (category) {
        case 'SERIAL_RX':
            return receiverOptionsFor(uiPort);
        case 'MAVLINK':
            // A MAVLink port without the receiver role still does something -
            // it is a GCS/telemetry link - so do not label it like "off".
            return [{ value: '', label: i18n.getMessage('portsTypeTelemetry') }].concat(receiverOptionsFor(uiPort));
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

/*
 * A port newly set to Serial RX takes the first receiver role no other port
 * holds, so adding the second receiver does not first claim, and clear, the
 * port carrying the first. With every offered role taken it takes Receiver,
 * which moves that role here as an explicit choice would.
 */
function defaultReceiverRole(uiPort) {
    const free = receiverOptionsFor(uiPort).find(function (option) {
        return !uiPorts.some(function (other) {
            return other !== uiPort && other.type === option.value;
        });
    });
    return free ? free.value : RECEIVER;
}

function defaultTypeFor(category, uiPort) {
    const options = typeOptionsFor(category, uiPort);
    if (category === 'SERIAL_RX') {
        return defaultReceiverRole(uiPort);
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

/* Each receiver role is global: assigning it to a port takes it off any other. */
function claimReceiver(identifier, type) {
    uiPorts.forEach(function (uiPort) {
        if (uiPort.identifier === identifier || uiPort.type !== type) {
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

function mavlinkSlotSetting(slot) {
    return 'mavlink_port' + (slot + 1) + '_serial';
}

function mavlinkSlotOf(identifier) {
    return mavlinkBindings ? mavlinkBindings.indexOf(identifier) : -1;
}

// Ports outside the table (USB VCP) keep their stored functions.
function portCarriesMavlink(identifier) {
    const uiPort = uiPorts.find(function (candidate) {
        return candidate.identifier === identifier;
    });
    if (uiPort) {
        return uiPort.function === 'MAVLINK';
    }
    const serialPort = FC.SERIAL_CONFIG.ports.find(function (candidate) {
        return candidate.identifier === identifier;
    });
    return !!serialPort && serialPort.functions.indexOf('TELEMETRY_MAVLINK') !== -1;
}

/*
 * Every MAVLink port needs a slot, or the firmware leaves it closed. A port
 * that has none takes the first free slot - unbound first, then one still
 * naming a port that no longer carries MAVLink. The choice is stored as a
 * concrete binding, never re-derived from port order.
 */
function freeMavlinkSlot(excludedSlot) {
    const isFree = function (identifier, slot) {
        return slot !== excludedSlot && identifier === SERIAL_PORT_NONE;
    };
    const isStale = function (identifier, slot) {
        return slot !== excludedSlot && !portCarriesMavlink(identifier);
    };
    const slot = mavlinkBindings.findIndex(isFree);
    return slot !== -1 ? slot : mavlinkBindings.findIndex(isStale);
}

function assignMavlinkSlot(uiPort) {
    if (!mavlinkBindings || uiPort.function !== 'MAVLINK' || mavlinkSlotOf(uiPort.identifier) !== -1) {
        return;
    }

    const slot = freeMavlinkSlot(-1);
    if (slot !== -1) {
        mavlinkBindings[slot] = uiPort.identifier;
    }
}

/*
 * Picking a slot another port holds swaps the two ports' slots. A port that
 * had no slot has nothing to swap, so a MAVLink holder moves to a free slot
 * instead; with none free the pick is refused rather than leaving the holder
 * (possibly USB VCP, which is not in this table) unbound. Returns the port
 * left without a slot, or null.
 */
function moveMavlinkSlot(uiPort, slot) {
    const previousSlot = mavlinkSlotOf(uiPort.identifier);
    const displaced = mavlinkBindings[slot];

    if (previousSlot === -1 && displaced !== SERIAL_PORT_NONE && portCarriesMavlink(displaced)) {
        const freeSlot = freeMavlinkSlot(slot);
        if (freeSlot === -1) {
            return displaced;
        }
        mavlinkBindings[freeSlot] = displaced;
    }

    mavlinkBindings[slot] = uiPort.identifier;
    if (previousSlot !== -1 && previousSlot !== slot) {
        mavlinkBindings[previousSlot] = displaced;
    }
    return null;
}

function renderMavlinkPortOption($row, uiPort) {
    const $mavlinkPort = $row.find('select.port-mavlink-port');
    const shown = !!mavlinkBindings && uiPort.function === 'MAVLINK';

    $row.find('.port-option--mavlink-port').toggle(shown);
    $mavlinkPort.empty();
    if (!shown) {
        return;
    }

    for (let slot = 0; slot < MAVLINK_PORT_COUNT; slot++) {
        $mavlinkPort.append($('<option/>', { value: slot, text: 'MAV' + (slot + 1) }));
    }
    $mavlinkPort.val(mavlinkSlotOf(uiPort.identifier));
}

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
    const typeOptions = typeOptionsFor(uiPort.function, uiPort);
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

    renderMavlinkPortOption($row, uiPort);

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
            '<span class="port-option port-option--mavlink-port">' +
            '<span class="port-option__label">' + i18n.getMessage('portsOptionMavlinkPort') + '</span>' +
            '<select class="port-mavlink-port"></select></span>' +
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

    // A MAVLink port loaded without a slot gets one now, so the save that
    // follows writes it; otherwise the firmware leaves that port closed.
    uiPorts.forEach(assignMavlinkSlot);
    renderAll($table);

    GUI.switchery();

    $body.off('change.portsTable');
    $body.on('change.portsTable', 'select.port-function', function (e) {
        const uiPort = portByRow($(e.currentTarget).closest('tr'));
        const mspCountBefore = countMspPorts();

        uiPort.function = $(e.currentTarget).val();
        uiPort.type = defaultTypeFor(uiPort.function, uiPort);
        uiPort.baudrate = defaultBaudFor(uiPort);
        clearSharedMsp(uiPort);
        uiPort.sharedTelemetry = '';
        assignMavlinkSlot(uiPort);

        if (serialPortHelper.isReceiverType(uiPort.type)) {
            claimReceiver(uiPort.identifier, uiPort.type);
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

        if (serialPortHelper.isReceiverType(uiPort.type)) {
            claimReceiver(uiPort.identifier, uiPort.type);
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

    $body.on('change.portsTable', 'select.port-mavlink-port', function (e) {
        const uiPort = portByRow($(e.currentTarget).closest('tr'));
        const slot = Number($(e.currentTarget).val());
        const stranded = moveMavlinkSlot(uiPort, slot);
        if (stranded !== null) {
            GUI.log(i18n.getMessage('portsMavlinkSlotRefused', [
                serialPortHelper.getPortName(uiPort.identifier), 'MAV' + (slot + 1),
                serialPortHelper.getPortName(stranded), MAVLINK_PORT_COUNT
            ]));
        }
        portsTable.clearValidation($table);
        renderAll($table);
    });

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
 * Each receiver port has to agree with the provider the Receiver tab sets for it.
 * This cannot be fixed automatically - either the port or the provider is
 * wrong and only the user knows which - so the save is refused instead.
 */
portsTable.validate = function ($table) {
    portsTable.clearValidation($table);

    let message = null;

    [RECEIVER, RECEIVER_SECONDARY].forEach(function (type) {
        const settings = receiverSettingsFor(type);
        if (message || !settings || settings.type !== 'SERIAL') {
            return;
        }

        const receiverPort = uiPorts.find(function (uiPort) {
            return uiPort.type === type;
        });
        if (!receiverPort) {
            // Dual RX's second serial receiver has no port of its own unless
            // one is assigned here, so a configuration without it is refused.
            if (type === RECEIVER_SECONDARY) {
                message = i18n.getMessage('portsReceiverSecondaryNoPort', [settings.provider]);
            }
            return;
        }

        const portName = serialPortHelper.getPortName(receiverPort.identifier);
        const role = i18n.getMessage(type === RECEIVER_SECONDARY ? 'portsTypeReceiverSecondary' : 'portsTypeReceiver');
        const mustBeMavlink = settings.provider === 'MAVLINK';

        if (mustBeMavlink && receiverPort.function !== 'MAVLINK') {
            message = i18n.getMessage('portsReceiverMismatchMavlink', [role, portName]);
        } else if (!mustBeMavlink && receiverPort.function === 'MAVLINK') {
            message = i18n.getMessage('portsReceiverMismatchSerialRx', [role, settings.provider, portName]);
        }

        if (message) {
            $table.find('.portConfiguration').filter(function () {
                return $(this).data('identifier') === receiverPort.identifier;
            }).addClass('invalid');
        }
    });

    // More MAVLink ports than slots: the extra one would never be opened.
    const unboundMavlinkPort = mavlinkBindings && uiPorts.find(function (uiPort) {
        return uiPort.function === 'MAVLINK' && mavlinkSlotOf(uiPort.identifier) === -1;
    });
    if (!message && unboundMavlinkPort) {
        message = i18n.getMessage('portsMavlinkNoSlot', [serialPortHelper.getPortName(unboundMavlinkPort.identifier), MAVLINK_PORT_COUNT]);
        $table.find('.portConfiguration').filter(function () {
            return $(this).data('identifier') === unboundMavlinkPort.identifier;
        }).addClass('invalid');
    }

    if (message) {
        GUI.log(message);
    }

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

/*
 * Write the MAVLink slot bindings that changed. Runs in the host tab's save
 * chain and, like Settings.saveInputs(), only moves on from a write that
 * landed: a refused or dropped write stops the chain before the serial config
 * that depends on it is saved, and the slot stays marked as unsaved.
 */
portsTable.saveMavlinkBindings = function (done) {
    if (!mavlinkBindings) {
        done();
        return;
    }

    const pending = [];
    mavlinkBindings.forEach(function (identifier, slot) {
        if (identifier !== storedMavlinkBindings[slot]) {
            pending.push(slot);
        }
    });

    function saveNext() {
        if (pending.length === 0) {
            done();
            return;
        }
        const slot = pending.shift();
        const identifier = mavlinkBindings[slot];
        mspHelper.setSetting(mavlinkSlotSetting(slot), identifier, function () {
            storedMavlinkBindings[slot] = identifier;
            saveNext();
        });
    }
    saveNext();
};

portsTable.cleanup = function () {
    if (mspWarningModal) {
        mspWarningModal.destroy();
        mspWarningModal = null;
    }
};

export default portsTable;

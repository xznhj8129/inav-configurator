'use strict';

import mspHelper from './../js/msp/MSPHelper';
import MSPCodes from './../js/msp/MSPCodes';
import MSP from './../js/msp';
import GUI from './../js/gui';
import FC from './../js/fc';
import i18n from './../js/localization';
import serialPortHelper from './../js/serialPortHelper';
import jBox from 'jbox';

const portsTab = {};

const VCP_IDENTIFIER = 20;
const RECEIVER = serialPortHelper.RECEIVER;

portsTab.initialize = function (callback) {

    // One decoded {identifier, function, type, baudrate} per editable port.
    // This array is the source of truth for the tab; the selects are rendered
    // from it and every change handler writes back to it.
    let uiPorts = [];
    let previousPorts = {};
    let mspWarningModal;
    let receiverType = null;
    let serialRxProvider = null;

    if (GUI.active_tab !== this) {
        GUI.active_tab = this;
    }

    mspHelper.loadSerialPorts(function () {
        loadReceiverSettings(function () {
            import('./ports.html?raw').then(({default: html}) => GUI.load(html, on_tab_loaded_handler));
        });
    });

    /*
     * The Receiver tab owns which protocol the receiver speaks; this tab only
     * says which port it is on. Both settings are read here so a port
     * assignment that contradicts the configured provider can be caught on save.
     */
    function loadReceiverSettings(done) {
        function readSetting(name) {
            return mspHelper.getSetting(name).then(function (setting) {
                if (setting && setting.setting && setting.setting.table && setting.setting.table.values) {
                    return setting.setting.table.values[setting.value];
                }
                return null;
            });
        }

        Promise.all([readSetting('receiver_type'), readSetting('serialrx_provider')]).then(function (values) {
            receiverType = values[0];
            serialRxProvider = values[1];
        }).catch(function () {
            // An FC that cannot report these simply gets no cross-tab validation.
            receiverType = null;
            serialRxProvider = null;
        }).then(done);
    }

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
        if (mspWarningModal && typeof mspWarningModal.open === 'function') {
            mspWarningModal.open();
        }
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

    function renderAll() {
        $('.tab-ports .portConfiguration').each(function () {
            const $row = $(this);
            const uiPort = uiPorts.find(function (port) {
                return port.identifier === $row.data('identifier');
            });
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

    function onFunctionChange(e) {
        const $row = $(e.currentTarget).closest('tr');
        const uiPort = portByRow($row);
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

        clearValidation();
        renderAll();
    }

    function onTypeChange(e) {
        const $row = $(e.currentTarget).closest('tr');
        const uiPort = portByRow($row);

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

        clearValidation();
        renderAll();
    }

    function onBaudChange(e) {
        const $row = $(e.currentTarget).closest('tr');
        portByRow($row).baudrate = $(e.currentTarget).val();
    }

    function update_ui() {
        $('.tab-ports').addClass('supported');

        const ports_e = $('.tab-ports .ports');
        const port_configuration_template_e = $('#tab-ports-templates .portConfiguration');

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

            const port_configuration_e = port_configuration_template_e.clone();
            port_configuration_e.data('identifier', serialPort.identifier);
            port_configuration_e.find('.identifier').text(serialPortHelper.getPortName(serialPort.identifier));
            port_configuration_e.find('.softSerialWarning')
                .css('display', serialPort.identifier >= 30 ? 'inline' : 'none');

            renderRow(port_configuration_e, uiPort);
            ports_e.find('tbody').append(port_configuration_e);
        });

        $('table.ports tbody').on('change', 'select.port-function', onFunctionChange);
        $('table.ports tbody').on('change', 'select.port-type', onTypeChange);
        $('table.ports tbody').on('change', 'select.port-baud', onBaudChange);
    }

    function clearValidation() {
        $('.tab-ports .portConfiguration').removeClass('invalid');
    }

    /*
     * The receiver port has to agree with the provider set on the Receiver tab.
     * This cannot be fixed automatically - either the port or the provider is
     * wrong and only the user knows which - so the save is refused instead.
     */
    function validateReceiverAssignment() {
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

        if (receiverMustBeMavlink() && receiverPort.function !== 'MAVLINK') {
            return {
                identifier: receiverPort.identifier,
                message: i18n.getMessage('portsReceiverMismatchMavlink', [portName])
            };
        }

        if (!receiverMustBeMavlink() && receiverPort.function === 'MAVLINK') {
            return {
                identifier: receiverPort.identifier,
                message: i18n.getMessage('portsReceiverMismatchSerialRx', [serialRxProvider, portName])
            };
        }

        return null;
    }

    function on_tab_loaded_handler() {

        i18n.localize();

        update_ui();

        mspWarningModal = new jBox('Modal', {
            width: 480,
            height: 200,
            closeButton: 'title',
            animation: false,
            title: i18n.getMessage('portsMspWarningTitle') || 'MSP Port Warning',
            content: $('#mspWarningContent')
        });

        if (countMspPorts() > 2) {
            showMSPWarning();
        }

        $('a.save').on('click', on_save_handler);

        GUI.content_ready(callback);
    }

    function on_save_handler() {

        clearValidation();

        const problem = validateReceiverAssignment();
        if (problem) {
            $('.tab-ports .portConfiguration').filter(function () {
                return $(this).data('identifier') === problem.identifier;
            }).addClass('invalid');
            GUI.log(problem.message);
            return;
        }

        const vcpPorts = FC.SERIAL_CONFIG.ports.filter(function (serialPort) {
            return serialPort.identifier === VCP_IDENTIFIER;
        });

        FC.SERIAL_CONFIG.ports = vcpPorts.concat(uiPorts.map(function (uiPort) {
            return serialPortHelper.encodeSerialPort(uiPort, previousPorts[uiPort.identifier]);
        }));

        mspHelper.saveSerialPorts(save_to_eeprom);

        function save_to_eeprom() {
            MSP.send_message(MSPCodes.MSP_EEPROM_WRITE, false, false, on_saved_handler);
        }

        function on_saved_handler() {
            GUI.log(i18n.getMessage('configurationEepromSaved'));

            GUI.tab_switch_cleanup(function() {
                MSP.send_message(MSPCodes.MSP_SET_REBOOT, false, false, on_reboot_success_handler);
            });
        }

        function on_reboot_success_handler() {
            GUI.log(i18n.getMessage('deviceRebooting'));
            GUI.handleReconnect($('.tab_ports a'));
        }
    }
};

portsTab.cleanup = function (callback) {
    $('.jBox-wrapper').remove();
    if (callback) callback();
};

export default portsTab;

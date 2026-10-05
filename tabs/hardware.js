'use strict';

import MSPChainerClass from './../js/msp/MSPchainer';
import mspHelper from './../js/msp/MSPHelper';
import MSPCodes from './../js/msp/MSPCodes';
import MSP from './../js/msp';
import GUI from './../js/gui';
import i18n from './../js/localization';
import Settings from './../js/settings';
import portsTable from './../js/portsTable';
import FC from './../js/fc';

const hardwareTab = {};

hardwareTab.initialize = function (callback) {

    /* PWM_TYPE_SRXL2. A port assigned to Spektrum Smart ESC with any other motor
     * protocol is never opened, so saving the port sets the protocol too. */
    const SRXL2_PROTOCOL = 7;

    if (GUI.active_tab !== this) {
        GUI.active_tab = this;
    }

    const loadChainer = new MSPChainerClass();

    loadChainer.setChain([
        mspHelper.loadSerialPorts,
        // Saving may have to write the motor protocol, and MSP_SET_ADVANCED_CONFIG
        // from a copy this tab never read would zero the rest of it.
        mspHelper.loadAdvancedConfig,
        loadSrxl2Status,
        portsTable.loadReceiverSettings
    ]);
    loadChainer.setExitPoint(load_html);
    loadChainer.execute();

    const saveChainer = new MSPChainerClass();

    saveChainer.setChain([
        saveSettings,
        saveSrxl2Protocol,
        mspHelper.saveSerialPorts,
        mspHelper.saveToEeprom
    ]);
    saveChainer.setExitPoint(reboot);

    // On a board without the Smart ESC driver this is an unsupported command,
    // and that is what keeps ESC_SRXL2 out of the port function list.
    function loadSrxl2Status(onComplete) {
        MSP.send_message(MSPCodes.MSP2_INAV_ESC_SRXL2_STATUS, false, false, onComplete);
    }

    function saveSettings(onComplete) {
        Settings.saveInputs(onComplete);
    }

    function saveSrxl2Protocol(onComplete) {
        const wantsSrxl2 = FC.SERIAL_CONFIG.ports.some(function (port) {
            return port.functions.includes('ESC_SRXL2');
        });

        if (!wantsSrxl2 || Number.parseInt(FC.ADVANCED_CONFIG.motorPwmProtocol, 10) === SRXL2_PROTOCOL) {
            onComplete();
            return;
        }

        // Logged, not silent: it changes how the motors are driven.
        FC.ADVANCED_CONFIG.motorPwmProtocol = SRXL2_PROTOCOL;
        GUI.log(i18n.getMessage('srxl2ProtocolAutoSet'));
        mspHelper.saveAdvancedConfig(onComplete);
    }

    function reboot() {
        GUI.log(i18n.getMessage('configurationEepromSaved'));

        GUI.tab_switch_cleanup(function () {
            MSP.send_message(MSPCodes.MSP_SET_REBOOT, false, false, reinitialize);
        });
    }

    function reinitialize() {
        GUI.log(i18n.getMessage('deviceRebooting'));
        GUI.handleReconnect($('.tab_hardware a'));
    }

    function load_html() {
        import('./hardware.html?raw').then(({default: html}) => GUI.load(html, Settings.processHtml(process_html)));
    }

    function process_html(settingsPromise) {
        i18n.localize();

        portsTable.render($('.tab-hardware table.ports'));

        let $i2cSpeed = $('#i2c_speed'),
            $i2cSpeedInfo = $('#i2c_speed-info');

        $i2cSpeed.on('change', function () {
            let $this = $(this),
                value = $this.children("option:selected").text();

            if (value == "400KHZ") {

                $i2cSpeedInfo.removeClass('ok-box');
                $i2cSpeedInfo.addClass('info-box');
                $i2cSpeedInfo.removeClass('warning-box');

                $i2cSpeedInfo.html(i18n.getMessage('i2cSpeedSuggested800khz'));
                $i2cSpeedInfo.show();

            } else if (value == "800KHZ") {
                $i2cSpeedInfo.removeClass('ok-box');
                $i2cSpeedInfo.removeClass('info-box');
                $i2cSpeedInfo.removeClass('warning-box');
                $i2cSpeedInfo.hide();
            } else {
                $i2cSpeedInfo.removeClass('ok-box');
                $i2cSpeedInfo.removeClass('info-box');
                $i2cSpeedInfo.addClass('warning-box');
                $i2cSpeedInfo.html(i18n.getMessage('i2cSpeedTooLow'));
                $i2cSpeedInfo.show();
            }

        });

        // The info box reflects the loaded value, so it cannot be primed until
        // the settings have arrived.
        settingsPromise.then(function () {
            $i2cSpeed.trigger('change');
        }).catch(function (error) {
            console.error('Settings load failed, i2c speed hint not initialized:', error);
        });

        $('a.save').on('click', function () {
            // A port assignment that contradicts the configured receiver
            // provider cannot be resolved automatically, so refuse the save
            // rather than write something the FC will not honour.
            if (portsTable.validate($('.tab-hardware table.ports'))) {
                return;
            }
            portsTable.apply();

            saveChainer.execute();
        });

        GUI.content_ready(callback);
    }
};

hardwareTab.cleanup = function (callback) {
    portsTable.cleanup();
    if (callback) callback();
};

export default hardwareTab;

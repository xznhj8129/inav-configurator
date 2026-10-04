'use strict';

import MSPChainerClass from './../js/msp/MSPchainer';
import mspHelper from './../js/msp/MSPHelper';
import MSPCodes from './../js/msp/MSPCodes';
import MSP from './../js/msp';
import GUI from './../js/gui';
import i18n from './../js/localization';
import Settings from './../js/settings';
import portsTable from './../js/portsTable';

const hardwareTab = {};

hardwareTab.initialize = function (callback) {

    if (GUI.active_tab !== this) {
        GUI.active_tab = this;
    }

    const loadChainer = new MSPChainerClass();

    loadChainer.setChain([
        mspHelper.loadSerialPorts,
        portsTable.loadReceiverSettings
    ]);
    loadChainer.setExitPoint(load_html);
    loadChainer.execute();

    const saveChainer = new MSPChainerClass();

    saveChainer.setChain([
        saveSettings,
        mspHelper.saveSerialPorts,
        mspHelper.saveToEeprom
    ]);
    saveChainer.setExitPoint(reboot);

    function saveSettings(onComplete) {
        Settings.saveInputs(onComplete);
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

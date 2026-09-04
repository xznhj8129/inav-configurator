#!/usr/bin/env node
/**
 * Round-trip tests for serialPortHelper.decodeSerialPort() /
 * encodeSerialPort() - the translation between the firmware's serial
 * function bitmask representation and the Ports tab's one-function-per-port
 * UI model.
 *
 * The rules under test:
 *   - a port carries exactly one conceptual function
 *   - TELEMETRY_MAVLINK + RX_SERIAL is the ONLY multi-function combination
 *     that survives; it decodes to MAVLink / Receiver
 *   - every other multi-function port is legacy shared-port configuration and
 *     decodes to None, so saving writes functions=[]
 *   - encoding starts from the port's previous config, so baud fields the
 *     selected function does not own are left alone
 *
 * serialPortHelper.js imports './fc', './bitHelper' and './localization' with
 * extensionless specifiers that only vite resolves, so - as in
 * tests/fc-generate-aux-config.test.mjs - the real source is loaded with those
 * three imports rewritten to local stubs. decodeSerialPort/encodeSerialPort
 * themselves touch none of the three.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = mkdtempSync(join(tmpdir(), 'ports-codec-'));
process.on('exit', () => rmSync(tmpDir, { recursive: true, force: true }));

function writeStub(name, source) {
    const outPath = join(tmpDir, name);
    writeFileSync(outPath, source, 'utf8');
    return pathToFileURL(outPath).href;
}

const fcStub = writeStub('fc.mjs', 'export default { SERIAL_CONFIG: { ports: [] } };\n');
const bitHelperStub = writeStub('bitHelper.mjs',
    'export default { bit_set: (n, i) => n | (1 << i), bit_check: (n, i) => (n & (1 << i)) !== 0 };\n');
const i18nStub = writeStub('localization.mjs', 'export default { getMessage: (key) => key };\n');

let source = readFileSync(join(repoRoot, 'js/serialPortHelper.js'), 'utf8');
for (const [regex, replacement, label] of [
    [/^import FC from '\.\/fc';$/m, `import FC from '${fcStub}';`, 'import FC'],
    [/^import BitHelper from '\.\/bitHelper';$/m, `import BitHelper from '${bitHelperStub}';`, 'import BitHelper'],
    [/^import i18n from '\.\/localization';$/m, `import i18n from '${i18nStub}';`, 'import i18n'],
]) {
    if (!regex.test(source)) {
        throw new Error(`ports-serial-port-codec.test.mjs: could not rewrite "${label}" in js/serialPortHelper.js - update the substitution rules.`);
    }
    source = source.replace(regex, replacement);
}
const helperUrl = writeStub('serialPortHelper.mjs', source);
const { default: serialPortHelper } = await import(helperUrl);

const RECEIVER = serialPortHelper.RECEIVER;

/** A firmware port config with all four baud fields populated. */
function port(functions, overrides = {}) {
    return Object.assign({
        identifier: 1,
        functions,
        msp_baudrate: '115200',
        telemetry_baudrate: 'AUTO',
        sensors_baudrate: '115200',
        peripherals_baudrate: '115200',
    }, overrides);
}

test('decode: empty function list is None', () => {
    const ui = serialPortHelper.decodeSerialPort(port([]));
    assert.equal(ui.function, 'NONE');
    assert.equal(ui.type, '');
});

test('decode/encode: MSP round-trips', () => {
    const ui = serialPortHelper.decodeSerialPort(port(['MSP']));
    assert.equal(ui.function, 'MSP');
    assert.equal(ui.type, '');
    assert.equal(ui.baudrate, '115200');
    assert.deepEqual(serialPortHelper.encodeSerialPort(ui, port(['MSP'])).functions, ['MSP']);
});

test('decode/encode: MAVLink without receiver round-trips', () => {
    const ui = serialPortHelper.decodeSerialPort(port(['TELEMETRY_MAVLINK'], { telemetry_baudrate: '460800' }));
    assert.equal(ui.function, 'MAVLINK');
    assert.equal(ui.type, '');
    assert.equal(ui.baudrate, '460800');

    const encoded = serialPortHelper.encodeSerialPort(ui, port(['TELEMETRY_MAVLINK']));
    assert.deepEqual(encoded.functions, ['TELEMETRY_MAVLINK']);
    assert.equal(encoded.telemetry_baudrate, '460800');
});

test('decode/encode: MAVLink receiver round-trips as the two-bit pair', () => {
    const ui = serialPortHelper.decodeSerialPort(port(['TELEMETRY_MAVLINK', 'RX_SERIAL']));
    assert.equal(ui.function, 'MAVLINK');
    assert.equal(ui.type, RECEIVER);

    const encoded = serialPortHelper.encodeSerialPort(ui, port(['TELEMETRY_MAVLINK', 'RX_SERIAL']));
    assert.deepEqual(encoded.functions.slice().sort(), ['RX_SERIAL', 'TELEMETRY_MAVLINK']);
});

test('decode: the MAVLink pair is recognized in either bit order', () => {
    const ui = serialPortHelper.decodeSerialPort(port(['RX_SERIAL', 'TELEMETRY_MAVLINK']));
    assert.equal(ui.function, 'MAVLINK');
    assert.equal(ui.type, RECEIVER);
});

test('decode/encode: plain serial RX round-trips', () => {
    const ui = serialPortHelper.decodeSerialPort(port(['RX_SERIAL']));
    assert.equal(ui.function, 'SERIAL_RX');
    assert.equal(ui.type, RECEIVER);
    assert.equal(ui.baudrate, '', 'serial RX has no user-selectable port baud');
    assert.deepEqual(serialPortHelper.encodeSerialPort(ui, port(['RX_SERIAL'])).functions, ['RX_SERIAL']);
});

test('decode/encode: telemetry protocol round-trips', () => {
    const ui = serialPortHelper.decodeSerialPort(port(['TELEMETRY_LTM'], { telemetry_baudrate: '57600' }));
    assert.equal(ui.function, 'TELEMETRY');
    assert.equal(ui.type, 'TELEMETRY_LTM');
    assert.equal(ui.baudrate, '57600');

    const encoded = serialPortHelper.encodeSerialPort(ui, port(['TELEMETRY_LTM']));
    assert.deepEqual(encoded.functions, ['TELEMETRY_LTM']);
    assert.equal(encoded.telemetry_baudrate, '57600');
});

test('decode/encode: sensor round-trips with the sensor baud', () => {
    const ui = serialPortHelper.decodeSerialPort(port(['GPS'], { sensors_baudrate: '115200' }));
    assert.equal(ui.function, 'SENSOR');
    assert.equal(ui.type, 'GPS');
    assert.equal(ui.baudrate, '115200');

    const encoded = serialPortHelper.encodeSerialPort(ui, port(['GPS']));
    assert.deepEqual(encoded.functions, ['GPS']);
    assert.equal(encoded.sensors_baudrate, '115200');
});

test('decode/encode: peripheral round-trips with the peripheral baud', () => {
    const ui = serialPortHelper.decodeSerialPort(port(['TBS_SMARTAUDIO'], { peripherals_baudrate: '19200' }));
    assert.equal(ui.function, 'PERIPHERAL');
    assert.equal(ui.type, 'TBS_SMARTAUDIO');
    assert.equal(ui.baudrate, '19200');

    const encoded = serialPortHelper.encodeSerialPort(ui, port(['TBS_SMARTAUDIO']));
    assert.deepEqual(encoded.functions, ['TBS_SMARTAUDIO']);
    assert.equal(encoded.peripherals_baudrate, '19200');
});

for (const legacy of [
    ['MSP', 'TELEMETRY_LTM'],
    ['MSP', 'TELEMETRY_MAVLINK'],
    ['RX_SERIAL', 'TELEMETRY_LTM'],
    ['GPS', 'TBS_SMARTAUDIO'],
    ['TELEMETRY_LTM', 'BLACKBOX'],
    ['MSP', 'RX_SERIAL', 'GPS'],
]) {
    test(`decode: legacy combination [${legacy}] resets the port`, () => {
        const ui = serialPortHelper.decodeSerialPort(port(legacy));
        assert.equal(ui.function, 'NONE');
        assert.equal(ui.type, '');
        assert.deepEqual(serialPortHelper.encodeSerialPort(ui, port(legacy)).functions, []);
    });
}

test('decode: a function with no UI rule resets the port', () => {
    // LOG has a firmware function ID but no rule, so it was never selectable.
    const ui = serialPortHelper.decodeSerialPort(port(['LOG']));
    assert.equal(ui.function, 'NONE');
});

test('encode: baud fields the selected function does not own are preserved', () => {
    const original = port(['GPS'], { sensors_baudrate: '19200', telemetry_baudrate: '57600' });

    // GPS -> MAVLink -> GPS must not disturb the stored sensor baud.
    const asMavlink = serialPortHelper.encodeSerialPort(
        { identifier: 1, function: 'MAVLINK', type: '', baudrate: '460800' }, original);
    assert.equal(asMavlink.sensors_baudrate, '19200');
    assert.equal(asMavlink.telemetry_baudrate, '460800');

    const backToGps = serialPortHelper.encodeSerialPort(
        serialPortHelper.decodeSerialPort(original), asMavlink);
    assert.deepEqual(backToGps.functions, ['GPS']);
    assert.equal(backToGps.sensors_baudrate, '19200');
});

test('encode: None clears the functions but keeps the stored bauds', () => {
    const original = port(['GPS'], { sensors_baudrate: '19200' });
    const encoded = serialPortHelper.encodeSerialPort(
        { identifier: 1, function: 'NONE', type: '', baudrate: '' }, original);
    assert.deepEqual(encoded.functions, []);
    assert.equal(encoded.sensors_baudrate, '19200');
});

test('categories: every rule maps to exactly one category', () => {
    const categories = serialPortHelper.CATEGORIES.filter(c => c !== 'NONE');
    const seen = new Set();
    for (const category of categories) {
        for (const rule of serialPortHelper.getFunctionsForCategory(category)) {
            assert.ok(!seen.has(rule.name), `${rule.name} appears in more than one category`);
            seen.add(rule.name);
        }
    }
    for (const rule of serialPortHelper.getRules()) {
        assert.ok(seen.has(rule.name), `${rule.name} is not reachable from any category`);
    }
});

test('categories: MAVLink is promoted out of the telemetry list', () => {
    const telemetry = serialPortHelper.getFunctionsForCategory('TELEMETRY').map(r => r.name);
    assert.ok(!telemetry.includes('TELEMETRY_MAVLINK'));
    assert.deepEqual(serialPortHelper.getFunctionsForCategory('MAVLINK').map(r => r.name), ['TELEMETRY_MAVLINK']);
});

test('baud fields: one visible dropdown maps to the right firmware field', () => {
    assert.equal(serialPortHelper.getBaudFieldForCategory('MSP'), 'msp_baudrate');
    assert.equal(serialPortHelper.getBaudFieldForCategory('MAVLINK'), 'telemetry_baudrate');
    assert.equal(serialPortHelper.getBaudFieldForCategory('TELEMETRY'), 'telemetry_baudrate');
    assert.equal(serialPortHelper.getBaudFieldForCategory('SENSOR'), 'sensors_baudrate');
    assert.equal(serialPortHelper.getBaudFieldForCategory('PERIPHERAL'), 'peripherals_baudrate');
    assert.equal(serialPortHelper.getBaudFieldForCategory('SERIAL_RX'), null);
    assert.equal(serialPortHelper.getBaudFieldForCategory('NONE'), null);
});

#!/usr/bin/env node
/**
 * Round-trip examples test runner
 *
 * Run with: node run_round_trip_examples_tests.cjs
 */

'use strict';

const { runner } = require('./simple_test_runner.cjs');
const { registerRoundTripTests } = require('./round_trip_examples.test.cjs');

async function main() {
  await registerRoundTripTests();
  await runner.run();
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

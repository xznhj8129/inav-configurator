export default {
  key: 'multi-condition',
  name: 'Multiple Conditions',
  description: 'Combine multiple flight parameters',
  category: 'Advanced',
  code: `// Multiple conditions example
const { flight, override } = inav;

// Only boost VTX if far AND high
if (flight.homeDistance > 200 && flight.altitude > 50) {
  override.vtx.power = 4;
}

// Reduce throttle if battery low OR RSSI weak
if (flight.cellVoltage < 350 || flight.rssi < 40) {
  override.throttleScale = 60;
}`
};

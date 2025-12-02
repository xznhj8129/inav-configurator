export default {
  key: 'altitude-stages',
  name: 'Altitude-based Stages',
  description: 'Different settings at different altitudes',
  category: 'Navigation',
  code: `// Different VTX settings by altitude
const { flight, override } = inav;

if (flight.altitude > 50) {
  override.vtx.power = 3;
}

if (flight.altitude > 100) {
  override.vtx.power = 4;
}

if (flight.altitude < 10) {
  override.vtx.power = 1; // Low power near ground
}`
};

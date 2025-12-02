export default {
  key: 'edge-detection',
  name: 'Edge Detection',
  description: 'Detect rising edge of a condition (executes once)',
  category: 'Advanced',
  code: `// Detect when RSSI drops below threshold (once)
const { flight, gvar, edge } = inav;

edge(() => flight.rssi < 30, { duration: 100 }, () => {
  gvar[0] = 1; // Set warning flag
  override.vtx.power = 4; // Boost power
});`
};

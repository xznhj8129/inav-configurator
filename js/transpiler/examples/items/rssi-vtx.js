export default {
  key: 'rssi-vtx',
  name: 'RSSI-based VTX Power',
  description: 'Boost VTX power when RSSI drops',
  category: 'VTX',
  code: `// Boost VTX power when signal weakens
const { flight, override, rc, gvar, waypoint, pid, helpers, events } = inav;

if (flight.rssi < 50) {
  override.vtx.power = 3;
}

if (flight.rssi < 30) {
  override.vtx.power = 4; // Max power
}`
};

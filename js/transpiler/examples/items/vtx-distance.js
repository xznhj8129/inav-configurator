export default {
  key: 'vtx-distance',
  name: 'VTX Power by Distance',
  description: 'Increase VTX power automatically when far from home',
  category: 'VTX',
  code: `// Auto VTX power based on distance
const { flight, override, rc, gvar, waypoint, pid, helpers, events } = inav;

if (flight.homeDistance > 100) {
  override.vtx.power = 3; // High power
}

if (flight.homeDistance > 500) {
  override.vtx.power = 4; // Max power
}`
};

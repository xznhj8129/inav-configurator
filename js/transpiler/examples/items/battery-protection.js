export default {
  key: 'battery-protection',
  name: 'Battery Protection',
  description: 'Reduce throttle when battery voltage is low',
  category: 'Safety',
  code: `// Battery protection - reduce throttle on low voltage
const { flight, override, rc, gvar, waypoint, pid, helpers, events } = inav;

if (flight.cellVoltage < 350) {
  override.throttleScale = 50; // 50% throttle limit
}

if (flight.cellVoltage < 330) {
  override.throttleScale = 25; // 25% throttle limit - RTH!
}`
};

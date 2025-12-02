export default {
  key: 'gps-check',
  name: 'GPS Fix Check',
  description: 'Monitor GPS fix status',
  category: 'Safety',
  code: `// Check GPS fix before allowing certain operations
const { flight, gvar } = inav;

if (flight.gpsSats < 6) {
  gvar[0] = 0; // No GPS - flag it
}

if (flight.gpsSats >= 6) {
  gvar[0] = 1; // Good GPS
}`
};

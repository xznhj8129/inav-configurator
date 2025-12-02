export default {
  key: 'simple-counter',
  name: 'Simple Counter',
  description: 'Count events using global variables',
  category: 'Basic',
  code: `// Simple event counter
const { flight, gvar, edge } = inav;

// Initialize counter once on arm
edge(() => flight.armTimer > 1000, { duration: 0 }, () => {
  gvar[0] = 0;
});

// This runs continuously - increments every time altitude > 100
if (flight.altitude > 100) {
  gvar[0] = gvar[0] + 1;
}`
};

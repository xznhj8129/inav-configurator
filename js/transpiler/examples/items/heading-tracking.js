export default {
  key: 'heading-tracking',
  name: 'Track Heading Changes',
  description: 'Initialize heading on arm, then monitor changes',
  category: 'Navigation',
  code: `// Track heading changes
const { flight, gvar, edge } = inav;

// Save initial heading once on arm
edge(() => flight.armTimer > 1000, { duration: 0 }, () => {
  gvar[0] = flight.yaw;
});

// If heading changed more than 90 degrees
if (Math.abs(flight.yaw - gvar[0]) > 90) {
  gvar[1] = 1; // Set flag
}`
};

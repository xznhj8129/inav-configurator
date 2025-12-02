export default {
  key: 'arm-init',
  name: 'Arm Initialization',
  description: 'Initialize variables once when arming (executes once)',
  category: 'Basic',
  code: `// Initialize variables on arm (executes only once)
const { flight, gvar, edge } = inav;

edge(() => flight.armTimer > 1000, { duration: 0 }, () => {
  gvar[0] = flight.yaw;    // Save initial heading
  gvar[1] = 0;             // Reset counter
});`
};

export default {
  key: 'waypoint-arrival',
  name: 'Waypoint Arrival Detection',
  description: 'Detect when arriving at waypoint',
  category: 'Navigation',
  code: `// Detect waypoint arrival
const { waypoint, gvar } = inav;

if (waypoint.distanceToNext < 10) {
  gvar[0] = 1; // Arrived at waypoint
}

if (waypoint.distanceToNext > 20) {
  gvar[0] = 0; // Not at waypoint
}`
};

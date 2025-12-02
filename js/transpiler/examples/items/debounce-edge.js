export default {
  key: 'debounce-edge',
  name: 'Debounced Edge Detection',
  description: 'Detect condition change with debounce time',
  category: 'Advanced',
  code: `// Detect RSSI drop with 500ms debounce
const { flight, gvar, edge } = inav;

// Only triggers once when RSSI < 40, ignores bouncing
edge(() => flight.rssi < 40, { duration: 500 }, () => {
  gvar[0] = gvar[0] + 1; // Count RSSI drop events
});`
};

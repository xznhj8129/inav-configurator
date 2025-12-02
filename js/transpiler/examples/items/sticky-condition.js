export default {
  key: 'sticky-condition',
  name: 'Sticky/Latching Condition',
  description: 'Condition that latches ON and needs reset',
  category: 'Advanced',
  code: `// Sticky condition - latches ON until reset
const { flight, gvar, sticky } = inav;

// Latch ON when RSSI < 30, OFF when RSSI > 70
sticky(
  () => flight.rssi < 30,  // ON condition
  () => flight.rssi > 70,  // OFF condition
  () => {
    override.vtx.power = 4; // Max power while latched
  }
);`
};

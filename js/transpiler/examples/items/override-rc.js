export default {
  key: 'override-rc',
  name: 'Override RC channel from speed',
  description: 'Override RC channel based on ground speed',
  category: 'RC Control',
  code: `// 
const { flight, override, rc } = inav;

if (flight.groundSpeed > 1000) {  // >10 m/s
  rc[9] = 1700;
} else {
  rc[9] = 1500;   // Center
}`
};

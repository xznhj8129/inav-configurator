export default {
  key: 'rc-controlled',
  name: 'RC Switch Control',
  description: 'Use RC switch to control features',
  category: 'RC Control',
  code: `// Use RC switch to control VTX power
const { rc, override } = inav;

if (rc[5].high) {
  override.vtx.power = 4; // Switch high = max power
}

if (rc[5].mid) {
  override.vtx.power = 2; // Switch mid = medium power
}

if (rc[5].low) {
  override.vtx.power = 1; // Switch low = min power
}`
};

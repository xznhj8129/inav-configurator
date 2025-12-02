/**
 * Round-trip each example: JS -> CLI -> JS -> CLI. Fails with full diff per example.
 */
'use strict';

require('./simple_test_runner.cjs');

let loadedModules;

async function loadModules() {
  if (loadedModules) return loadedModules;
  const transpilerModule = await import('../index.js');
  const decompilerModule = await import('../decompiler.js');
  const examplesModule = await import('../../examples/index.js');

  loadedModules = {
    Transpiler: transpilerModule.Transpiler,
    Decompiler: decompilerModule.Decompiler,
    examples: examplesModule.default
  };
  return loadedModules;
}

function parseLogic(commands) {
  return commands
    .filter(line => line.trim().startsWith('logic'))
    .map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        index: parseInt(parts[1], 10),
        enabled: parseInt(parts[2], 10),
        activatorId: parseInt(parts[3], 10),
        operation: parseInt(parts[4], 10),
        operandAType: parseInt(parts[5], 10),
        operandAValue: parseInt(parts[6], 10),
        operandBType: parseInt(parts[7], 10),
        operandBValue: parseInt(parts[8], 10),
        flags: parseInt(parts[9], 10)
      };
    });
}

function stripDisabled(logic) {
  return logic.filter(lc => !(lc.enabled === 0 && lc.operation === 0 && lc.activatorId === -1));
}

function formatLogic(logic) {
  return logic.map(lc => `logic ${lc.index} ${lc.enabled} ${lc.activatorId} ${lc.operation} ${lc.operandAType} ${lc.operandAValue} ${lc.operandBType} ${lc.operandBValue} ${lc.flags}`).join('\n');
}

async function registerRoundTripTests() {
  const { Transpiler, Decompiler, examples } = await loadModules();

  describe('Round-trip Examples', () => {
    for (const [key, example] of Object.entries(examples)) {
      test(`example '${key}' round-trip`, async () => {
        // First transpile
        const t1 = new Transpiler();
        const r1 = t1.transpile(example.code);
        if (!r1.success) {
          throw new Error(`Initial transpile failed:\n${r1.error || 'unknown error'}`);
        }
        const logic1 = stripDisabled(parseLogic(r1.commands.map(c => c.trim())));

        // Decompile
        const decompiler = new Decompiler();
        const dec = decompiler.decompile(logic1);
        if (!dec.success) {
          throw new Error(`Decompile failed:\n${dec.error || 'unknown error'}`);
        }

        // Second transpile
        const t2 = new Transpiler();
        const r2 = t2.transpile(dec.code);
        if (!r2.success) {
          throw new Error(`Re-transpile failed:\n${r2.error || 'unknown error'}`);
        }
        const logic2 = stripDisabled(parseLogic(r2.commands.map(c => c.trim())));

        // Compare
        if (logic1.length !== logic2.length ||
            logic1.some((lc, idx) => JSON.stringify(lc) !== JSON.stringify(logic2[idx]))) {
          const diff = [
            `Original active CLI (${logic1.length}):`,
            formatLogic(logic1),
            `Round-trip active CLI (${logic2.length}):`,
            formatLogic(logic2)
          ].join('\n');
          throw new Error(diff);
        }
      });
    }
  });
}

module.exports = { registerRoundTripTests };

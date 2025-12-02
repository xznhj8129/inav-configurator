/**
 * INAV Programming PID API Definition
 * 
 * Location: js/transpiler/api/definitions/pid.js
 * 
 * Programming PID controllers expose only their output via logic conditions.
 * Firmware operand type: LOGIC_CONDITION_OPERAND_TYPE_PID (type 6), operand value = PID index.
 */

'use strict';

import { OPERAND_TYPE } from '../../transpiler/inav_constants.js';

// Generate PID controller definitions (pid[0] through pid[3])
const pidControllers = {};

for (let i = 0; i < 4; i++) {
  pidControllers[i] = {
    type: 'object',
    desc: `Programming PID controller ${i}`,
    readonly: true,
    properties: {
      output: {
        type: 'number',
        desc: `PID ${i} controller output`,
        readonly: true,
        inavOperand: { type: OPERAND_TYPE.PID, value: i }
      }
    }
  };
}

export default pidControllers;

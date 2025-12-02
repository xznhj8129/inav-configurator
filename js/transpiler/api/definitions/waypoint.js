/**
 * INAV Waypoint Navigation API Definition
 * 
 * Location: js/transpiler/api/definitions/waypoint.js
 * 
 * Waypoint mission parameters and state.
 * Source: src/main/navigation/navigation_pos_estimator.c
 */

'use strict';

import { OPERAND_TYPE, WAYPOINT_PARAM } from '../../transpiler/inav_constants.js';

export default {
  isWp: {
    type: 'boolean',
    desc: 'Mission is currently in waypoint mode (NAV_AUTO_WP)',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.IS_WP }
  },

  index: {
    type: 'number',
    desc: 'Active waypoint index',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.WAYPOINT_INDEX }
  },

  action: {
    type: 'number',
    desc: 'Active waypoint action code',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.WAYPOINT_ACTION }
  },

  nextAction: {
    type: 'number',
    desc: 'Next waypoint action code',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.NEXT_WAYPOINT_ACTION }
  },

  distanceToNext: {
    type: 'number',
    unit: 'm',
    desc: 'Distance to active waypoint',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.WAYPOINT_DISTANCE }
  },

  distanceFromPrev: {
    type: 'number',
    unit: 'm',
    desc: 'Distance from previous waypoint',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.DISTANCE_FROM_WAYPOINT }
  },

  userAction1: {
    type: 'boolean',
    desc: 'User action 1 flag on previous waypoint',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.USER1_ACTION }
  },

  userAction2: {
    type: 'boolean',
    desc: 'User action 2 flag on previous waypoint',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.USER2_ACTION }
  },

  userAction3: {
    type: 'boolean',
    desc: 'User action 3 flag on previous waypoint',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.USER3_ACTION }
  },

  userAction4: {
    type: 'boolean',
    desc: 'User action 4 flag on previous waypoint',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.USER4_ACTION }
  },

  nextUserAction1: {
    type: 'boolean',
    desc: 'User action 1 flag on active waypoint',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.USER1_ACTION_NEXT_WP }
  },

  nextUserAction2: {
    type: 'boolean',
    desc: 'User action 2 flag on active waypoint',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.USER2_ACTION_NEXT_WP }
  },

  nextUserAction3: {
    type: 'boolean',
    desc: 'User action 3 flag on active waypoint',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.USER3_ACTION_NEXT_WP }
  },

  nextUserAction4: {
    type: 'boolean',
    desc: 'User action 4 flag on active waypoint',
    readonly: true,
    inavOperand: { type: OPERAND_TYPE.WAYPOINTS, value: WAYPOINT_PARAM.USER4_ACTION_NEXT_WP }
  },
};

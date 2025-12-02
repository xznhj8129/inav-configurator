/**
 * INAV JavaScript Programming Examples
 *
 * Location: js/transpiler/examples/index.js
 */

'use strict';

import altitudeStages from './items/altitude-stages.js';
import armInit from './items/arm-init.js';
import batteryProtection from './items/battery-protection.js';
import debounceEdge from './items/debounce-edge.js';
import edgeDetection from './items/edge-detection.js';
import gpsCheck from './items/gps-check.js';
import headingTracking from './items/heading-tracking.js';
import multiCondition from './items/multi-condition.js';
import overrideRc from './items/override-rc.js';
import rcControlled from './items/rc-controlled.js';
import rssiVtx from './items/rssi-vtx.js';
import simpleCounter from './items/simple-counter.js';
import stickyCondition from './items/sticky-condition.js';
import vtxDistance from './items/vtx-distance.js';
import waypointArrival from './items/waypoint-arrival.js';

const allExamples = [
  altitudeStages,
  armInit,
  batteryProtection,
  debounceEdge,
  edgeDetection,
  gpsCheck,
  headingTracking,
  multiCondition,
  overrideRc,
  rcControlled,
  rssiVtx,
  simpleCounter,
  stickyCondition,
  vtxDistance,
  waypointArrival
];

const examples = Object.fromEntries(
  allExamples.map(ex => [ex.key, { name: ex.name, description: ex.description, category: ex.category, code: ex.code }])
);

export default examples;

import { createGrandBouleStore } from '../stores/grandBouleStore';

import { applyGrandBouleMorphState } from './applyGrandBouleMorphState';
import { syncMidiCalibrationToEngine } from './calibrateGrandBouleMidi/syncMidiCalibrationToEngine';
import { hydrateGrandBouleMorphStateFromProject } from './hydrateGrandBouleMorphStateFromProject';
import { resolveGrandBouleEngine } from './resolveGrandBouleEngine';

/**
 * Apply authoritative project state to session state and a ready live engine.
 *
 * The per-device store is the calibration's single source of truth for every
 * Grand Boule body: `hydrateGrandBouleMorphStateFromProject` already stood one
 * up above (`createGrandBouleStore` is idempotent — it returns the existing
 * store rather than resetting it), so a device that comes up ready here also
 * gets its stored calibration mirrored onto the live node, not left on
 * whatever the Web Audio node's own construction default is (#4310). Without
 * this, a device whose panel was never opened would build its native body
 * from the store's defaults (via `projectGrandBouleCalibrationToNativePatch`)
 * while its web node stayed on the DSP's raw defaults, splitting the two
 * carriers in the uncalibrated case exactly as #4302 did in the calibrated one.
 */
export function reconcileGrandBouleDeviceStateFromProject(deviceId: string): void {
    const morph = hydrateGrandBouleMorphStateFromProject(deviceId);
    if (morph === null) {
        return;
    }
    const engine = resolveGrandBouleEngine({ deviceId });
    if (engine.isReady()) {
        applyGrandBouleMorphState(engine, morph);
        syncMidiCalibrationToEngine({ engine, store: createGrandBouleStore(deviceId) });
    }
}

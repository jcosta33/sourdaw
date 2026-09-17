/**
 * A calibrated store as the numeric record a freshly built native Grand
 * Boule body needs (#4302).
 *
 * `resolveGrandBouleEngine.spec.ts` covers the live mirror; this covers the
 * build-time half — a native body constructed after a calibration was set
 * (a device splice rebuilds it at every Play) must start on the calibrated
 * half-pedal edge rather than the DSP's own default.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES } from '../../models/GrandBouleCalibrationDspParamNames';
import {
    createDefaultGrandBouleState,
    createGrandBouleStore,
    peekGrandBouleStore,
    resetGrandBouleStores,
    subscribeToGrandBouleStoreCreation,
} from '../../stores/grandBouleStore';
import { projectGrandBouleCalibrationToNativePatch } from '../projectGrandBouleCalibrationToNativePatch';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../');

/** Strip line and block comments so brace matching does not see prose. */
function stripComments(source: string): string {
    return source.replaceAll(/\/\*[\S\s]*?\*\//g, ' ').replaceAll(/\/\/[^\n]*/g, ' ');
}

describe('projectGrandBouleCalibrationToNativePatch', () => {
    beforeEach(() => {
        resetGrandBouleStores();
    });

    it('answers null for a device with no store, and never creates one', () => {
        const deviceId = 'grand-boule-no-store';
        // A peek→create swap would still fail the return-value assertion below,
        // but only after line 43; nothing there observes whether a store was
        // stood up in passing. `createGrandBouleStore` notifies every listener
        // on creation, so a listener that never fires for this id is the direct
        // observation that `peekGrandBouleStore` — not `createGrandBouleStore`
        // — is what this projection calls.
        const created: string[] = [];
        const unsubscribe = subscribeToGrandBouleStoreCreation((createdDeviceId) => created.push(createdDeviceId));

        const projected = projectGrandBouleCalibrationToNativePatch({ deviceId });

        expect(projected).toBeNull();
        expect(peekGrandBouleStore(deviceId)).toBeUndefined();
        expect(created).not.toContain(deviceId);
        unsubscribe();
    });

    it('projects the store defaults for a store that exists but was never calibrated, e.g. hydration', () => {
        // Distinguishes "no store" (null, above) from "a store exists at its
        // untouched defaults" (projected, not null) — the distinction the
        // projection's own doc comment used to get backwards (#4310).
        const deviceId = 'grand-boule-hydrated-uncalibrated';
        createGrandBouleStore(deviceId);

        const projected = projectGrandBouleCalibrationToNativePatch({ deviceId });

        expect(projected).toEqual({ sustain_threshold: 0.15, cc_smoothing_ms: 5 });
    });

    it('projects a calibrated store into the DSP names', () => {
        const deviceId = 'grand-boule-calibrated';
        const store = createGrandBouleStore(deviceId);
        const state = createDefaultGrandBouleState();
        store.set({
            ...state,
            midiCalibration: { ...state.midiCalibration, sustainThreshold: 0.6, ccSmoothingMs: 40 },
        });

        const projected = projectGrandBouleCalibrationToNativePatch({ deviceId });

        expect(projected).toEqual({ sustain_threshold: 0.6, cc_smoothing_ms: 40 });
    });

    // Welds the constant this projection and the live engine handle share
    // against the Rust arms themselves, the same pattern
    // `declaredRangeVsKnobTravel.spec.ts` uses: a hand-copied name can drift
    // from the DSP's own vocabulary without either side noticing.
    it('emits keys the DSP actually matches on', () => {
        const source = stripComments(
            readFileSync(resolve(REPO_ROOT, 'crates/daw-dsp/src/grand_boule/engine.rs'), 'utf8')
        );

        for (const dspName of Object.values(GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES)) {
            expect(source).toMatch(new RegExp(`"${dspName}"\\s*=>`));
        }
    });
});

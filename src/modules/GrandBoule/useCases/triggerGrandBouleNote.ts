/**
 * Trigger a Grand Boule note.
 *
 * Applies the store's midi calibration curve and dispatches to the WASM engine
 * handle. Does nothing if the engine has not yet attached.
 */

import { type Store } from '#/infra/store/types';
import { clamp } from '#/utils/Math/clamp';

import { type GrandBouleMidiCalibration, createDefaultMidiCalibration } from '../models/GrandBouleMidiCalibration';
import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

type TriggerGrandBouleNoteInput = {
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
    midiNote: number;
    /** Normalised velocity in 0.0 .. 1.0 (pre-curve). */
    velocity: number;
};

/**
 * Deterministic fallback applied before the store has hydrated its
 * calibration. Computed once so an uninitialised-store note is shaped through
 * the exact same curve as every later note (linear, full 0..1 range).
 */
const FALLBACK_CALIBRATION = createDefaultMidiCalibration();

/**
 * Shape an already-normalised 0..1 velocity through a calibration curve.
 *
 * Unlike `applyVelocityCurve` (which takes a raw 0..127 MIDI value), this
 * operates directly on the normalised velocity, avoiding a precision-losing
 * `*127` then `/127` round-trip.
 */
function shapeNormalisedVelocity(velocity: number, calibration: GrandBouleMidiCalibration): number {
    const normalised = clamp(velocity, 0, 1);
    const curved = normalised ** calibration.velocityCurveExponent;
    const { velocityFloor, velocityCeiling } = calibration;
    return velocityFloor + curved * (velocityCeiling - velocityFloor);
}

export function triggerGrandBouleNote(input: TriggerGrandBouleNoteInput): void {
    if (!input.engine.isReady()) {
        return;
    }
    const calibration = input.store.value?.midiCalibration ?? FALLBACK_CALIBRATION;
    const shaped = shapeNormalisedVelocity(input.velocity, calibration);
    input.engine.noteOn({ midiNote: input.midiNote, velocity: shaped });
}

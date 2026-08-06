import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';

import { setMidiCalibrationParam } from './setMidiCalibrationParam';
import { syncMidiCalibrationToEngine } from './syncMidiCalibrationToEngine';

type SetCcSmoothingMsInput = {
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
    value: number;
};

/**
 * Calibrate how hard the continuous sustain controller is smoothed.
 *
 * CC64 arrives in 128 steps at whatever rate the controller scans, so a swept
 * pedal steps the damper bandwidth rather than sliding it. This is the
 * one-pole time constant that turns those steps back into a slide; 0 ms
 * restores the raw stepped response.
 *
 * It reaches the damper curve only. The engine's discrete "pedal engaged"
 * decision — which note-offs the pedal catches — keeps reading the raw
 * controller value, so a heavily smoothed pedal never swallows a note-off for
 * tens of milliseconds after it was lifted.
 */
export function setCcSmoothingMs(input: SetCcSmoothingMsInput): void {
    setMidiCalibrationParam(input.store, 'ccSmoothingMs', input.value);
    syncMidiCalibrationToEngine({ engine: input.engine, store: input.store });
}

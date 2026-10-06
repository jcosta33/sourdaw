import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

type SyncGrandBouleVoicingToEngineInput = {
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
};

/**
 * Push the temperament and preset voicing the store holds onto both bodies.
 *
 * The load-side half of #4727, beside `syncMidiCalibrationToEngine` for
 * calibration: the store is hydrated from project truth by
 * `hydrateGrandBouleMorphStateFromProject`, and without this push the reloaded
 * piano would sound Equal temperament with the neutral voicing until the user
 * touched the panel again. `engine.setTemperament` and `engine.setParam` are
 * the same doors a panel pick uses, so a natively carried body hears the
 * tuning the web node plays.
 */
export function syncGrandBouleVoicingToEngine(input: SyncGrandBouleVoicingToEngineInput): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }
    input.engine.setTemperament({ index: state.temperament });
    input.engine.setParam({ name: 'hammer_hardness', value: state.parameters.hammerHardness });
    input.engine.setParam({ name: 'tone_tilt', value: state.parameters.toneTilt });
    input.engine.setParam({ name: 'stereo_width', value: state.parameters.stereoWidth });
    input.engine.setParam({ name: 'velocity_curve', value: state.parameters.velocityCurve });
}

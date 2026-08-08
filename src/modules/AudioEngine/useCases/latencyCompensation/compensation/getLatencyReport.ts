import { trackStore } from '#/modules/Arrangement/stores';

import { type TrackLatency, type LatencyReport } from '../../../models/LatencyCompensationTypes';
import { audioEngine } from '../../../repositories/createWebAudioEngine';

import { getMaxTrackLatency } from './getMaxTrackLatency';
import { getTrackLatency } from './getTrackLatency';

export function getLatencyReport(): LatencyReport {
    const state = trackStore.value;
    const tracks: TrackLatency[] = [];

    if (state) {
        for (const track of state.tracks) {
            tracks.push(getTrackLatency(track.id));
        }
    }

    const ctx = audioEngine.context;

    return {
        tracks,
        maxLatencyMs: getMaxTrackLatency(),
        contextBaseLatencyMs: (ctx.baseLatency ?? 0) * 1000,
        // Nullish, not `'outputLatency' in ctx`: a key that is present but
        // undefined satisfies `in`, and `undefined * 1000` is NaN — which now
        // reaches the user as `Output: NaNms (… + device NaNms)`. This must
        // match `createWebAudioEngine.getState()`, the other reader of the same
        // field, which has always used `?? 0`; two readers disagreeing about
        // what "missing" means is how one of them ends up printing NaN.
        contextOutputLatencyMs: (ctx.outputLatency ?? 0) * 1000,
    };
}

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
        contextOutputLatencyMs: ('outputLatency' in ctx ? (ctx as { outputLatency: number }).outputLatency : 0) * 1000,
    };
}

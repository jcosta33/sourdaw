import { trackStore } from '#/modules/Arrangement/stores';

import { type TrackLatency, type LatencyReport } from '../../../models/LatencyCompensationTypes';
import { audioEngine } from '../../../repositories/createWebAudioEngine';

import { captureLatencyCompensationSnapshot } from './captureLatencyCompensationSnapshot';

export function getLatencyReport(): LatencyReport {
    const state = trackStore.value;
    const tracks: TrackLatency[] = [];
    const latencyCompensation = captureLatencyCompensationSnapshot();

    if (state) {
        for (const track of state.tracks) {
            tracks.push(latencyCompensation.getTrackLatency(track.id));
        }
    }

    const ctx = audioEngine.context;

    return {
        tracks,
        maxLatencyMs: latencyCompensation.getMaxTrackLatency(),
        contextBaseLatencyMs: (ctx.baseLatency ?? 0) * 1000,
        contextOutputLatencyMs: ('outputLatency' in ctx ? (ctx as { outputLatency: number }).outputLatency : 0) * 1000,
    };
}

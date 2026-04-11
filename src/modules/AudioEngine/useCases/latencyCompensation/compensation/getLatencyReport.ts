import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { audioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';
import { type TrackLatency, type LatencyReport } from '#/modules/AudioEngine/models/LatencyCompensationTypes';
import { getMaxTrackLatency, getTrackLatency } from './helpers';

export function getLatencyReport(): LatencyReport {
    const state = getTrackStoreState();
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
        contextOutputLatencyMs:
            ('outputLatency' in ctx ? (ctx as unknown as { outputLatency: number }).outputLatency : 0) * 1000,
    };
}
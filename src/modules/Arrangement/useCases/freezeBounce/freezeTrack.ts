import { cacheAudioBuffer, getCompensationDelay } from '#/modules/AudioEngine/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { updateTrack } from '../../repositories/track/updateTrack';
import { computeTrackHash } from '../../services/computeTrackHash';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { trackStore } from '../../stores/trackStore';

import { renderTrackOffline } from './renderOffline';

/**
 * Beats of tail freeze renders past a track's content. Exported because the
 * unknown-baked-tail floor is derived from the longer of the two, and a
 * hand-copied literal there would drift silently.
 */
export const FREEZE_MAX_TAIL_BEATS = 8;
export const FREEZE_MIN_TAIL_BEATS = 4;

export const activeFreezeTasks = new Map<string, AbortController>();

export async function freezeTrack(trackId: string): Promise<boolean> {
    const state = trackStore.value;
    if (!state) {
        return false;
    }

    const track = state.tracks.find((time) => time.id === trackId);
    if (!track || track.freezeState.status === 'frozen') {
        return false;
    }
    if (!getTrackEligibility(track.kind).acceptsFreeze) {
        return false;
    }

    if (activeFreezeTasks.has(trackId)) {
        activeFreezeTasks.get(trackId)!.abort();
    }
    const abortController = new AbortController();
    activeFreezeTasks.set(trackId, abortController);

    updateTrack(trackId, (time) => ({
        ...time,
        freezeState: { ...time.freezeState, status: 'freezing', renderProgress: 0 },
    }));

    try {
        const hash = await computeTrackHash(track.clips, track.devices);

        let startBeat = Infinity;
        let endBeat = -Infinity;
        for (const context of track.clips) {
            if (context.startBeat < startBeat) {
                startBeat = context.startBeat;
            }
            if (context.endBeat > endBeat) {
                endBeat = context.endBeat;
            }
        }

        if (startBeat === Infinity) {
            startBeat = 0;
            endBeat = 1;
        }

        // Heuristic: If there's a reverb or delay in the chain, give it a longer tail
        const hasReverbOrDelay = track.devices.some(
            (data) => data.type.toLowerCase().includes('reverb') || data.type.toLowerCase().includes('delay')
        );
        const tailBeats = hasReverbOrDelay ? FREEZE_MAX_TAIL_BEATS : FREEZE_MIN_TAIL_BEATS;

        const renderedBuffer = await renderTrackOffline(track, startBeat, endBeat + tailBeats, {
            abortSignal: abortController.signal,
            onProgress: (param) => {
                updateTrack(trackId, (time) => ({
                    ...time,
                    freezeState: { ...time.freezeState, renderProgress: param },
                }));
            },
        });

        activeFreezeTasks.delete(trackId);

        if (!renderedBuffer) {
            throw new Error('Render failed');
        }

        const freezeId = `freeze-${trackId}-${Date.now()}`;
        cacheAudioBuffer({ buffer: renderedBuffer, bufferId: freezeId });

        // FX-4 residual — pin the compensation the chain carried while the
        // buffer was baked. Frozen playback compensates against this, so a later
        // plugin-latency change cannot drift the frozen take out of alignment
        // (nothing marks a frozen track stale on a latency change).
        const compensationSeconds = getCompensationDelay(trackId);

        updateTrack(trackId, (time) => ({
            ...time,
            frozen: true,
            frozenBufferId: freezeId,
            freezeState: {
                status: 'frozen',
                freezeId,
                frozenBufferId: freezeId,
                sourceContentHash: hash,
                compensationSeconds,
                renderSettings: {
                    sampleRate: renderedBuffer.sampleRate,
                    bitDepth: 32,
                    channelCount: renderedBuffer.numberOfChannels,
                    tailLengthSeconds: (tailBeats * 60) / (transportStore.value?.tempo ?? 120),
                },
                renderedAt: Date.now(),
            },
        }));
    } catch (error) {
        activeFreezeTasks.delete(trackId);

        if (abortController.signal.aborted) {
            // User cancelled
            updateTrack(trackId, (time) => ({
                ...time,
                freezeState: { status: 'unfrozen' },
            }));
            return true;
        }

        updateTrack(trackId, (time) => ({
            ...time,
            freezeState: {
                status: 'error',
                errorMessage: error instanceof Error ? error.message : String(error),
            },
        }));
    }

    return true;
}

import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { transportStore } from '#/modules/Transport/stores';

import { updateTrack } from '../../repositories/track/updateTrack';
import { computeTrackHash } from '../../services/computeTrackHash';
import { trackStore } from '../../stores/trackStore';

import { renderTrackOffline } from './renderOffline';

export const activeFreezeTasks = new Map<string, AbortController>();

export async function freezeTrack(trackId: string): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((time) => time.id === trackId);
    if (!track || track.freezeState.status === 'frozen') {
        return;
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
        const tailBeats = hasReverbOrDelay ? 8 : 4;

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
        audioBufferCache.set(freezeId, renderedBuffer);

        updateTrack(trackId, (time) => ({
            ...time,
            frozen: true,
            frozenBufferId: freezeId,
            freezeState: {
                status: 'frozen',
                freezeId,
                frozenBufferId: freezeId,
                sourceContentHash: hash,
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
            return;
        }

        updateTrack(trackId, (time) => ({
            ...time,
            freezeState: {
                status: 'error',
                errorMessage: error instanceof Error ? error.message : String(error),
            },
        }));
    }
}

import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { updateTrack } from '../../repositories/track/updateTrack';
import { computeTrackHash } from '../../services/computeTrackHash';
import { trackStore } from '../../stores/trackStore';

import { renderTrackOffline } from './renderOffline';

export const activeFreezeTasks = new Map<string, AbortController>();

function create_freezing_state(track: NonNullable<typeof trackStore.value>['tracks'][number]) {
    const freeze_state = { ...track.freezeState };
    delete freeze_state.adjustmentLayerMutationId;
    delete freeze_state.errorMessage;
    return { ...freeze_state, status: 'freezing' as const, renderProgress: 0 };
}

function invalidate_finished_render(trackId: string): void {
    updateTrack(trackId, (track) => {
        if (track.freezeState.status !== 'freezing') {
            return track;
        }
        if (track.frozen && track.frozenBufferId && track.freezeState.frozenBufferId) {
            const freeze_state = { ...track.freezeState, status: 'stale' as const };
            delete freeze_state.renderProgress;
            return { ...track, freezeState: freeze_state };
        }
        return { ...track, frozen: false, freezeState: { status: 'unfrozen' } };
    });
}

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
        freezeState: create_freezing_state(time),
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
                    freezeState:
                        activeFreezeTasks.get(trackId) === abortController && time.freezeState.status === 'freezing'
                            ? { ...time.freezeState, renderProgress: param }
                            : time.freezeState,
                }));
            },
        });

        if (!renderedBuffer) {
            throw new Error('Render failed');
        }

        if (activeFreezeTasks.get(trackId) !== abortController) {
            return;
        }
        const current_track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
        if (
            !current_track ||
            current_track.freezeState.status !== 'freezing' ||
            current_track.freezeState.adjustmentLayerMutationId
        ) {
            activeFreezeTasks.delete(trackId);
            invalidate_finished_render(trackId);
            return;
        }

        const freezeId = `freeze-${trackId}-${Date.now()}`;
        cacheAudioBuffer({ buffer: renderedBuffer, bufferId: freezeId });

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
        activeFreezeTasks.delete(trackId);
    } catch (error) {
        const active_task = activeFreezeTasks.get(trackId);
        if (active_task !== abortController) {
            if (!active_task && abortController.signal.aborted) {
                updateTrack(trackId, (time) =>
                    time.freezeState.status === 'freezing'
                        ? { ...time, frozen: false, freezeState: { status: 'unfrozen' } }
                        : time
                );
            }
            return;
        }
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

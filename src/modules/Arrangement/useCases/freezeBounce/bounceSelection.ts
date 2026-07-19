import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { type Clip, type Track } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';

import { renderTrackOffline } from './renderOffline';

export async function bounceSelection(
    trackId: string,
    startBeat: number,
    endBeat: number,
    runMutation: typeof runLegacyCommandMutation = runLegacyCommandMutation
): Promise<void> {
    // Selection bounce uses hardcoded options for now, but could be extended
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((time) => time.id === trackId);
    if (!track) {
        return;
    }

    const clipsInRange = track.clips.filter((context) => context.endBeat > startBeat && context.startBeat < endBeat);
    if (clipsInRange.length === 0) {
        return;
    }

    const virtualTrack: Track = {
        ...track,
        clips: clipsInRange.map((context) => ({
            ...context,
            startBeat: Math.max(context.startBeat, startBeat),
            endBeat: Math.min(context.endBeat, endBeat),
        })),
    };

    const renderedBuffer = await renderTrackOffline(virtualTrack, startBeat, endBeat);

    if (!renderedBuffer) {
        return;
    }

    const audioBufferId = `bounce-sel-${trackId}-${Date.now()}`;
    cacheAudioBuffer({ buffer: renderedBuffer, bufferId: audioBufferId });

    const bouncedClip: Clip = {
        id: `bounced-sel-${crypto.randomUUID()}`,
        trackId,
        name: `${track.name} (selection bounce)`,
        startBeat,
        endBeat,
        type: 'audio',
        audioBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
    };

    await runMutation((pushUndoEntry) => {
        const freshState = trackStore.value;
        if (!freshState) {
            return;
        }

        const tracksBefore = structuredClone(freshState.tracks);

        trackStore.set({
            ...freshState,
            tracks: freshState.tracks.map((time) => {
                if (time.id !== trackId) {
                    return time;
                }
                const keptClips = time.clips.filter(
                    (context) => context.endBeat <= startBeat || context.startBeat >= endBeat
                );
                return {
                    ...time,
                    clips: [...keptClips, bouncedClip],
                };
            }),
        });

        const tracksAfter = structuredClone(trackStore.value?.tracks ?? []);
        pushUndoEntry(
            'Bounce Selection',
            () => {
                const state1 = trackStore.value;
                if (state1) {
                    trackStore.set({ ...state1, tracks: tracksBefore });
                }
            },
            () => {
                const state1 = trackStore.value;
                if (state1) {
                    trackStore.set({ ...state1, tracks: tracksAfter });
                }
            }
        );
    });
}

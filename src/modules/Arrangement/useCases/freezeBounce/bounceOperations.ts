import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { type Clip, type Track } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';

import { renderTrackOffline } from './renderOffline';

export type BounceOptions = {
    includeInserts: boolean;
    includeSends: boolean;
    includeAutomation: boolean;
    normalization: 'off' | 'protection' | 'full';
    tailHandling: 'auto' | 'manual' | 'off';
    destination: 'new-track' | 'replace';
};

export async function bounceTrack(trackId: string, options: BounceOptions): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((time) => time.id === trackId);
    if (!track || track.clips.length === 0) {
        return;
    }

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

    // Add tail if requested
    let finalEndBeat = endBeat;
    if (options.tailHandling === 'manual') {
        const tempo = transportStore.value?.tempo ?? 120;
        finalEndBeat += (5 * tempo) / 60; // 5 seconds fixed tail
    }

    const renderedBuffer = await renderTrackOffline(track, startBeat, finalEndBeat, {
        includeInserts: options.includeInserts,
        includeSends: options.includeSends,
        includeAutomation: options.includeAutomation,
        normalization: options.normalization,
        autoTail: options.tailHandling === 'auto',
    });

    if (!renderedBuffer) {
        return;
    }

    const audioBufferId = `bounce-${trackId}-${Date.now()}`;
    cacheAudioBuffer({ buffer: renderedBuffer, bufferId: audioBufferId });

    const bouncedClip: Clip = {
        id: `bounced-clip-${crypto.randomUUID()}`,
        trackId: options.destination === 'replace' ? trackId : `track-bounce-${crypto.randomUUID()}`,
        name: `${track.name} (bounced)`,
        startBeat,
        endBeat: finalEndBeat,
        type: 'audio',
        audioBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
    };

    const freshState = trackStore.value;
    if (!freshState) {
        return;
    }

    // Snapshot for undo
    const tracksBefore = structuredClone(freshState.tracks);

    if (options.destination === 'replace') {
        trackStore.set({
            ...freshState,
            tracks: freshState.tracks.map((time) => {
                if (time.id !== trackId) {
                    return time;
                }
                return {
                    ...time,
                    clips: [bouncedClip],
                    devices: options.includeInserts ? [] : time.devices,
                };
            }),
        });
    } else {
        const altId = `alt-bounce-${crypto.randomUUID().slice(0, 8)}`;
        const newTrack: Track = {
            ...track,
            id: bouncedClip.trackId,
            name: `${track.name} (bounce)`,
            kind: 'audio',
            clips: [bouncedClip],
            devices: options.includeInserts ? [] : track.devices,
            sends: options.includeSends ? [] : track.sends,
            frozen: false,
            freezeState: { status: 'unfrozen' },
            alternatives: [{ id: altId, name: 'Bounced', clips: [bouncedClip] }],
            activeAlternativeId: altId,
        };

        const insertIndex = freshState.tracks.findIndex((time) => time.id === trackId) + 1;
        const tracks = [...freshState.tracks];
        tracks.splice(insertIndex, 0, newTrack);
        trackStore.set({ ...freshState, tracks });
    }

    // Register undo for the bounce operation
    const tracksAfter = structuredClone(trackStore.value?.tracks ?? []);
    pushUndoEntry(
        'Bounce Track',
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
}

export async function bounceInPlace(trackId: string): Promise<void> {
    return bounceTrack(trackId, {
        includeInserts: true,
        includeSends: false,
        includeAutomation: true,
        normalization: 'protection',
        tailHandling: 'auto',
        destination: 'replace',
    });
}

export async function bounceToNewTrack(trackId: string): Promise<void> {
    return bounceTrack(trackId, {
        includeInserts: true,
        includeSends: false,
        includeAutomation: true,
        normalization: 'protection',
        tailHandling: 'auto',
        destination: 'new-track',
    });
}

export async function bounceSelection(trackId: string, startBeat: number, endBeat: number): Promise<void> {
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
}

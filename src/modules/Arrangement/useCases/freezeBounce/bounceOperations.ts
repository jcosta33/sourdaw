import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { getTransportState } from '#/modules/Transport/useCases';

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

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.clips.length === 0) {
        return;
    }

    let startBeat = Infinity;
    let endBeat = -Infinity;
    for (const c of track.clips) {
        if (c.startBeat < startBeat) {
            startBeat = c.startBeat;
        }
        if (c.endBeat > endBeat) {
            endBeat = c.endBeat;
        }
    }

    // Add tail if requested
    let finalEndBeat = endBeat;
    if (options.tailHandling === 'manual') {
        const tempo = getTransportState()?.tempo ?? 120;
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
    audioBufferCache.set(audioBufferId, renderedBuffer);

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
            tracks: freshState.tracks.map((t) => {
                if (t.id !== trackId) {
                    return t;
                }
                return {
                    ...t,
                    clips: [bouncedClip],
                    devices: options.includeInserts ? [] : t.devices,
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

        const insertIndex = freshState.tracks.findIndex((t) => t.id === trackId) + 1;
        const tracks = [...freshState.tracks];
        tracks.splice(insertIndex, 0, newTrack);
        trackStore.set({ ...freshState, tracks });
    }

    // Register undo for the bounce operation
    const tracksAfter = structuredClone(trackStore.value?.tracks ?? []);
    pushUndoEntry(
        'Bounce Track',
        () => {
            const s = trackStore.value;
            if (s) {
                trackStore.set({ ...s, tracks: tracksBefore });
            }
        },
        () => {
            const s = trackStore.value;
            if (s) {
                trackStore.set({ ...s, tracks: tracksAfter });
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

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
        return;
    }

    const clipsInRange = track.clips.filter((c) => c.endBeat > startBeat && c.startBeat < endBeat);
    if (clipsInRange.length === 0) {
        return;
    }

    const virtualTrack: Track = {
        ...track,
        clips: clipsInRange.map((c) => ({
            ...c,
            startBeat: Math.max(c.startBeat, startBeat),
            endBeat: Math.min(c.endBeat, endBeat),
        })),
    };

    const renderedBuffer = await renderTrackOffline(virtualTrack, startBeat, endBeat);

    if (!renderedBuffer) {
        return;
    }

    const audioBufferId = `bounce-sel-${trackId}-${Date.now()}`;
    audioBufferCache.set(audioBufferId, renderedBuffer);

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
        tracks: freshState.tracks.map((t) => {
            if (t.id !== trackId) {
                return t;
            }
            const keptClips = t.clips.filter((c) => c.endBeat <= startBeat || c.startBeat >= endBeat);
            return {
                ...t,
                clips: [...keptClips, bouncedClip],
            };
        }),
    });

    const tracksAfter = structuredClone(trackStore.value?.tracks ?? []);
    pushUndoEntry(
        'Bounce Selection',
        () => {
            const s = trackStore.value;
            if (s) {
                trackStore.set({ ...s, tracks: tracksBefore });
            }
        },
        () => {
            const s = trackStore.value;
            if (s) {
                trackStore.set({ ...s, tracks: tracksAfter });
            }
        }
    );
}

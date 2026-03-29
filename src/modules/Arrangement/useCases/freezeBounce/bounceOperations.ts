import { trackStore } from '../../stores/trackStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { type Clip, type Track } from '../../models/Track';
import { renderTrackOffline } from './renderOffline';

let frozenClipId = 1;

export async function bounceInPlace(trackId: string): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.clips.length === 0) {
        return;
    }

    const startBeat = Math.min(...track.clips.map((c) => c.startBeat));
    const endBeat = Math.max(...track.clips.map((c) => c.endBeat));

    const renderedBuffer = await renderTrackOffline(track, startBeat, endBeat);

    const audioBufferId = renderedBuffer ? `bounce-${trackId}-${Date.now()}` : undefined;
    if (renderedBuffer && audioBufferId) {
        audioBufferCache.set(audioBufferId, renderedBuffer);
    }

    const bouncedClip: Clip = {
        id: `frozen-clip-${frozenClipId++}`,
        trackId,
        name: `${track.name} (bounced)`,
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

    trackStore.set({
        ...freshState,
        tracks: freshState.tracks.map((t) => {
            if (t.id !== trackId) {
                return t;
            }
            return {
                ...t,
                clips: [bouncedClip],
                devices: [],
            };
        }),
    });
}

export async function bounceToNewTrack(trackId: string): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.clips.length === 0) {
        return;
    }

    const startBeat = Math.min(...track.clips.map((c) => c.startBeat));
    const endBeat = Math.max(...track.clips.map((c) => c.endBeat));

    const renderedBuffer = await renderTrackOffline(track, startBeat, endBeat);
    const audioBufferId = renderedBuffer ? `bounce-new-${trackId}-${Date.now()}` : undefined;
    if (renderedBuffer && audioBufferId) {
        audioBufferCache.set(audioBufferId, renderedBuffer);
    }

    const newTrackId = `track-bounce-${Date.now()}`;
    const bouncedClip: Clip = {
        id: `bounced-new-${frozenClipId++}`,
        trackId: newTrackId,
        name: `${track.name} (bounced)`,
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

    const newTrack: Track = {
        id: newTrackId,
        name: `${track.name} (bounce)`,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: track.color,
        clips: [bouncedClip],
        devices: [],
        sends: [],
        frozen: false,
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        alternatives: [{ id: 'alt-main', name: 'Main', clips: [bouncedClip] }],
        activeAlternativeId: 'alt-main',
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };

    const insertIndex = freshState.tracks.findIndex((t) => t.id === trackId) + 1;
    const tracks = [...freshState.tracks];
    tracks.splice(insertIndex, 0, newTrack);

    trackStore.set({ ...freshState, tracks });
}

export async function bounceSelection(trackId: string, startBeat: number, endBeat: number): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.clips.length === 0) {
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

    const audioBufferId = renderedBuffer ? `bounce-sel-${trackId}-${Date.now()}` : undefined;
    if (renderedBuffer && audioBufferId) {
        audioBufferCache.set(audioBufferId, renderedBuffer);
    }

    const bouncedClip: Clip = {
        id: `bounced-sel-${frozenClipId++}`,
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
}

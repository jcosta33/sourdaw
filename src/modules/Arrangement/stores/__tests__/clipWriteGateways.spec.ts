import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Clip, type Track } from '../../models/Track';
import { appendClipToTrack } from '../appendClipToTrack';
import { defaultTrackState, trackStore } from '../trackStore';
import { updateClipInStore } from '../updateClipInStore';

function makeClip(id: string, trackId: string): Clip {
    return {
        id,
        trackId,
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#fff',
        locked: false,
        muted: false,
    };
}

function makeTrack(id: string, clips: Clip[] = []): Track {
    return {
        id,
        name: id,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#fff',
        clips,
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
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
        activeAlternativeId: `${id}-alt`,
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function setRuntimeKind(track: Track, kind: string): Track {
    Object.defineProperty(track, 'kind', { configurable: true, enumerable: true, value: kind });
    return track;
}

function setTracks(tracks: Track[]): void {
    trackStore.set({ ...defaultTrackState, tracks });
}

describe('clip write gateways', () => {
    beforeEach(() => {
        setTracks([]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        setTracks([]);
    });

    it('writes eligible additions and updates exactly once', () => {
        const originalClip = makeClip('clip-1', 'track-1');
        setTracks([makeTrack('track-1', [originalClip])]);
        const storeWrite = vi.spyOn(trackStore, 'set');

        expect(appendClipToTrack('track-1', makeClip('clip-2', 'track-1'))).toBe(true);
        expect(storeWrite).toHaveBeenCalledTimes(1);

        storeWrite.mockClear();
        const updater = vi.fn((clip: Clip) => ({ ...clip, name: 'updated' }));
        expect(updateClipInStore('clip-1', updater)).toBe(true);
        expect(updater).toHaveBeenCalledTimes(1);
        expect(storeWrite).toHaveBeenCalledTimes(1);
    });

    it('returns false without callbacks or writes for missing state or targets', () => {
        setTracks([makeTrack('track-1')]);
        const storeWrite = vi.spyOn(trackStore, 'set');
        const updater = vi.fn((clip: Clip) => clip);

        expect(appendClipToTrack('missing', makeClip('clip-1', 'missing'))).toBe(false);
        expect(updateClipInStore('missing', updater)).toBe(false);
        expect(updater).not.toHaveBeenCalled();
        expect(storeWrite).not.toHaveBeenCalled();

        vi.spyOn(trackStore, 'value', 'get').mockReturnValue(null);
        expect(appendClipToTrack('track-1', makeClip('clip-1', 'track-1'))).toBe(false);
        expect(updateClipInStore('clip-1', updater)).toBe(false);
        expect(updater).not.toHaveBeenCalled();
        expect(storeWrite).not.toHaveBeenCalled();
    });

    it('returns false without callbacks or writes for VCA-owned targets', () => {
        const vcaTrack = setRuntimeKind(makeTrack('vca-1', [makeClip('vca-clip', 'vca-1')]), 'vca');
        setTracks([vcaTrack]);
        const storeWrite = vi.spyOn(trackStore, 'set');
        const updater = vi.fn((clip: Clip) => clip);

        expect(appendClipToTrack('vca-1', makeClip('new-clip', 'vca-1'))).toBe(false);
        expect(updateClipInStore('vca-clip', updater)).toBe(false);
        expect(updater).not.toHaveBeenCalled();
        expect(storeWrite).not.toHaveBeenCalled();
    });
});

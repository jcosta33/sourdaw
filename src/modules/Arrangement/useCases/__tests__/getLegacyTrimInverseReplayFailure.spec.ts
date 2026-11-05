import { afterEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type Clip, type Track, defaultTrackState, trackStore } from '../../stores/trackStore';
import { getLegacyTrimInverseReplayFailure } from '../getLegacyTrimInverseReplayFailure';

function clip(id: string, type: Clip['type']): Clip {
    return {
        id,
        trackId: `t-${type}`,
        name: id,
        startBeat: 0,
        endBeat: 16,
        type,
        audioOffsetBeats: 0,
        midiOffsetBeats: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

// Mirrors createTrack's defaults; the model itself is private to Arrangement.
function track(kind: 'audio' | 'midi', clips: Clip[]): Track {
    return {
        id: `t-${kind}`,
        name: kind,
        kind,
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '',
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
        activeAlternativeId: `alt-${kind}`,
        alternatives: [{ id: `alt-${kind}`, name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function keylessTrim(clipId: string): AppAction {
    return { type: 'trimClipStart', payload: { clipId, newStartBeat: 2, loopOriginBeat: null } };
}

function seed(): void {
    trackStore.set({
        ...defaultTrackState,
        tracks: [track('audio', [clip('audio-clip', 'audio')]), track('midi', [clip('midi-clip', 'midi')])],
    });
}

afterEach(() => {
    trackStore.set(defaultTrackState);
});

describe('getLegacyTrimInverseReplayFailure', () => {
    it('admits a list with no keyless trim inverse', () => {
        seed();
        const keyed: AppAction = {
            type: 'trimClipStart',
            payload: { clipId: 'midi-clip', newStartBeat: 2, loopOriginBeat: null, midiOffsetBeats: 0 },
        };

        expect(getLegacyTrimInverseReplayFailure([keyed, { type: 'toggleLoop' }])).toBeNull();
    });

    it('admits a keyless audio trim preceded only by coordinate-preserving inverses', () => {
        seed();
        const rename: AppAction = { type: 'renameClip', payload: { clipId: 'audio-clip', name: 'Renamed' } };

        expect(getLegacyTrimInverseReplayFailure([rename, keylessTrim('audio-clip')])).toBeNull();
    });

    it('refuses a keyless trim whose target no track owns', () => {
        seed();

        expect(getLegacyTrimInverseReplayFailure([keylessTrim('gone')])).toBe(
            'The legacy trim target cannot be identified safely'
        );
    });

    it('refuses a keyless trim after an inverse that can move project content', () => {
        seed();

        expect(getLegacyTrimInverseReplayFailure([{ type: 'toggleLoop' }, keylessTrim('audio-clip')])).toBe(
            'An earlier inverse cannot prove the legacy trim coordinates'
        );
    });

    it('refuses a keyless MIDI trim, which carries no captured offset', () => {
        seed();

        expect(getLegacyTrimInverseReplayFailure([keylessTrim('midi-clip')])).toBe(
            'The legacy MIDI trim has no captured offset'
        );
    });
});

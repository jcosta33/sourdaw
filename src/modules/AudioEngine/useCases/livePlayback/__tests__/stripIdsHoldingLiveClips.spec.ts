/**
 * The strips Web Audio is left to voice when there is no programme at all.
 *
 * `readLiveGraphProgramme` answers an unconfigured clock with an empty
 * programme, and this is the only thing that stops that programme from telling
 * the carrier law a project full of clips has nothing to sound — which would
 * carry every plugin strip natively over material nothing native plays.
 */

import { describe, expect, it } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

import { stripIdsHoldingLiveClips } from '../stripIdsHoldingLiveClips';

function createTrack(overrides?: Partial<Track>): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'hw_out',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
        ...overrides,
    };
}

function midiClip(overrides?: Partial<Track['clips'][number]>): Track['clips'][number] {
    return {
        id: 'notes',
        trackId: 'audio-1',
        name: 'notes',
        startBeat: 0,
        endBeat: 2,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#00ff00',
        locked: false,
        muted: false,
        ...overrides,
    };
}

describe('stripIdsHoldingLiveClips', () => {
    it('names a strip holding a MIDI clip, which no native programme would ever admit', () => {
        const stripIds = stripIdsHoldingLiveClips([createTrack({ id: 'audio-1', kind: 'midi', clips: [midiClip()] })]);

        expect(stripIds.has('audio-1')).toBe(true);
    });

    it('leaves a strip with no live clip out, which is what lets its attached plugin carry it', () => {
        const stripIds = stripIdsHoldingLiveClips([
            createTrack({ id: 'audio-1' }),
            createTrack({ id: 'audio-2', kind: 'midi', clips: [midiClip({ muted: true })] }),
        ]);

        expect([...stripIds]).toEqual([]);
    });
});

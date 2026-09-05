/**
 * The strips Web Audio is left to voice when there is no programme at all.
 *
 * `readLiveGraphProgramme` answers an unconfigured clock with an empty
 * programme, and this is the only thing that stops that programme from telling
 * the carrier law a project full of clips has nothing to sound — which would
 * carry every plugin strip natively over material nothing native plays.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type TakeLaneStoreState, type Track } from '#/modules/Arrangement/stores';

import { stripIdsHoldingLiveClips } from '../stripIdsHoldingLiveClips';

const mocks = vi.hoisted(() => ({ takeLanes: { value: null as TakeLaneStoreState | null } }));

// The comped clip set is the one this producer answers over, and comping is
// read off the store rather than passed in. Only that one member is replaced:
// everything else the barrel exports is the real thing.
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    takeLaneStore: {
        get value() {
            return mocks.takeLanes.value;
        },
    },
}));

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

afterEach(() => {
    mocks.takeLanes.value = null;
});

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

    // A bus sums what tracks send it and plays nothing of its own, so no
    // carrier voices a clip parked on one. Naming it would hand the carrier law
    // a strip it does not answer for at all.
    it('leaves a bus out however live the clip parked on it is', () => {
        const stripIds = stripIdsHoldingLiveClips([
            createTrack({ id: 'bus-1', kind: 'bus', clips: [midiClip({ trackId: 'bus-1' })] }),
        ]);

        expect([...stripIds]).toEqual([]);
    });

    // The comped set is what a track plays, and it is not its `clips` array: a
    // comp region hands the span to the take it selects and leaves the clip
    // underneath unplayed. Reading the raw array here would name a strip over
    // material no carrier sounds, and the plugin on it would lose the session.
    it('follows the comped clip set rather than the clips the track holds', () => {
        mocks.takeLanes.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'audio-1',
                    takes: [
                        { id: 'take-b', clipId: 'alt-take', name: 'Take B', startBeat: 0, endBeat: 4, selected: true },
                    ],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'take-b' }],
                },
            ],
        };

        const stripIds = stripIdsHoldingLiveClips([
            createTrack({
                id: 'audio-1',
                kind: 'midi',
                clips: [
                    midiClip({ id: 'lead', trackId: 'audio-1', endBeat: 4 }),
                    midiClip({ id: 'alt-take', trackId: 'audio-1', endBeat: 4, muted: true }),
                ],
            }),
        ]);

        expect([...stripIds]).toEqual([]);
    });
});

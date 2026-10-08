import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, takeLaneStore, type TakeLaneStoreState } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { tempoMapStore } from '#/modules/Transport/stores';

import { resolveTrackClipsWithComping } from '../resolveTrackClipsWithComping';

type Take = TakeLaneStoreState['lanes'][number]['takes'][number];
type TempoChange = NonNullable<typeof tempoMapStore.value>['changes'][number];

function recording(startBeat: number, endBeat: number, audioOffsetBeats?: number): Clip {
    const clip: Clip = {
        id: 'rec',
        trackId: 't1',
        name: 'Recording',
        startBeat,
        endBeat,
        type: 'audio',
        audioBufferId: 'rec-buf',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
    };
    if (audioOffsetBeats !== undefined) {
        clip.audioOffsetBeats = audioOffsetBeats;
    }
    return clip;
}

function pass(id: string, loop: readonly [number, number], sourceOffsetBeats: number, passStartBeats?: number): Take {
    const take: Take = { id, clipId: 'rec', name: id, startBeat: loop[0], endBeat: loop[1], selected: false };
    take.sourceOffsetBeats = sourceOffsetBeats;
    if (passStartBeats !== undefined) {
        take.passStartBeats = passStartBeats;
    }
    return take;
}

function lane(takes: Take[], takeId: string, startBeat: number, endBeat: number): TakeLaneStoreState {
    return {
        lanes: [{ id: 'lane-1', trackId: 't1', takes, activeCompRegions: [{ startBeat, endBeat, takeId }] }],
    };
}

const loopPasses = (passStartBeats?: number) => [
    pass('pass-1', [0, 4], 0, passStartBeats),
    pass('pass-2', [0, 4], 4, passStartBeats),
];

const cases: readonly { name: string; state: TakeLaneStoreState; clip: Clip }[] = [
    { name: 'as recorded', state: lane(loopPasses(0), 'pass-2', 0, 4), clip: recording(0, 12) },
    { name: 'moved away from the comp', state: lane(loopPasses(0), 'pass-2', 0, 4), clip: recording(8, 20) },
    { name: 'moved under the comp', state: lane(loopPasses(0), 'pass-2', 8, 12), clip: recording(8, 20) },
    { name: 'slipped', state: lane(loopPasses(0), 'pass-2', 0, 4), clip: recording(0, 12, 1) },
    { name: 'start trimmed', state: lane(loopPasses(0), 'pass-2', 0, 4), clip: recording(2, 12, 2) },
    {
        name: 'recorded inside the loop',
        state: lane([pass('pass-2', [8, 16], 4, -4)], 'pass-2', 8, 16),
        clip: recording(8, 24, -4),
    },
    {
        name: 'recorded inside the loop, first pass comped',
        state: lane([pass('pass-1', [12, 16], 0, 0)], 'pass-1', 8, 16),
        clip: recording(8, 24, -4),
    },
    {
        name: 'recorded inside the loop, then slipped',
        state: lane([pass('pass-2', [8, 16], 4, -4)], 'pass-2', 8, 16),
        clip: recording(8, 24, -3),
    },
    {
        name: 'placed before a clip opening on the record point',
        state: lane([pass('pass-2', [8, 16], 4, -4)], 'pass-2', 8, 16),
        clip: recording(12, 24),
    },
    {
        name: 'saved before pass placement existed, content slipped later',
        state: lane(loopPasses(), 'pass-2', 0, 4),
        clip: recording(0, 12, -2),
    },
    {
        name: 'recorded inside the loop, then trimmed',
        state: lane([pass('pass-2', [8, 16], 4, -4)], 'pass-2', 8, 16),
        clip: recording(14, 24, 2),
    },
    {
        name: 'run-up with capture latency',
        state: lane([pass('pass-2', [2, 6], 5.5, 1.5)], 'pass-2', 2, 6),
        clip: recording(0.5, 10),
    },
    {
        name: 'saved before pass placement existed',
        state: lane(loopPasses(), 'pass-2', 0, 4),
        clip: recording(1, 12, 1),
    },
];

describe('live and offline comp resolution', () => {
    afterEach(() => {
        takeLaneStore.set({ lanes: [] });
    });

    it.each(cases)('resolve the same fragments for a pass $name', ({ state, clip }) => {
        takeLaneStore.set(state);
        expect(takeLaneStore.value).toEqual(state);

        const live = resolveClipsWithComping('t1', [clip]);
        const offline = resolveTrackClipsWithComping('t1', [clip], state);

        expect(offline).toEqual(live);
        expect(live.length).toBeGreaterThan(0);
    });
});

/** 120 BPM, dropping to 60 at `beat`. */
function dropTo60At(beat: number): TempoChange[] {
    return [
        { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
        { id: `tempo-${beat}`, beat, tempo: 60, curve: 'instant' },
    ];
}

// Takes as the commit places them across a tempo change, with the project's
// tempo map in force. Every offset is media seconds × the tempo at the
// fragment's own first beat / 60, the unit the readers seek in: a fragment
// must enter at the seconds the capture had run when what it plays sounded.
describe('live and offline comp resolution across a tempo change', () => {
    afterEach(() => {
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
    });

    /** Begun at 12 inside loop [8,16), capture from 6.98 s: the clip opens at 8 entering −2.98 s at 120 BPM. */
    const insideLoop = recording(8, 30, -5.96);

    it.each([
        {
            // Recorded from 12 with one bar of pre-roll (capture from 3.98 s)
            // into loop [16,24). The clip opens at 12, entering 2.02 s in;
            // pass 2 began 14.02 s into the capture, read at 60 BPM.
            name: 'a run-up pass across the drop',
            tempoChanges: dropTo60At(12),
            state: lane([pass('pass-2', [16, 24], 14.02, 6.02)], 'pass-2', 16, 24),
            clip: recording(12, 32, 2.02),
            entry: { startBeat: 16, audioOffsetBeats: 14.02 },
        },
        {
            // Pass 2 began 4.02 s into the capture, read at 120 BPM.
            name: 'pass 2 of a recording begun inside the loop',
            tempoChanges: dropTo60At(10),
            state: lane([pass('pass-2', [8, 16], 8.04, -5.96)], 'pass-2', 8, 16),
            clip: insideLoop,
            entry: { startBeat: 8, audioOffsetBeats: 8.04 },
        },
        {
            // Its first pass sounds from the record point, 0.02 s in at 60 BPM.
            name: 'pass 1 of a recording begun inside the loop',
            tempoChanges: dropTo60At(10),
            state: lane([pass('pass-1', [12, 16], 0.02, -1.96)], 'pass-1', 8, 16),
            clip: insideLoop,
            entry: { startBeat: 12, audioOffsetBeats: 0.02 },
        },
        {
            // Pass 3 began 11.02 s into the capture, read at 120 BPM.
            name: 'pass 3 of a recording begun inside the loop',
            tempoChanges: dropTo60At(10),
            state: lane([pass('pass-3', [8, 16], 22.04, -5.96)], 'pass-3', 8, 16),
            clip: insideLoop,
            entry: { startBeat: 8, audioOffsetBeats: 22.04 },
        },
        {
            // Comped over [8,12), the clip shows through from 12, where the
            // capture had run 0.02 s, read at 60 BPM.
            name: 'the clip filling in after a comp ending past the drop',
            tempoChanges: dropTo60At(10),
            state: lane([pass('pass-2', [8, 16], 8.04, -5.96)], 'pass-2', 8, 12),
            clip: insideLoop,
            entry: { startBeat: 12, audioOffsetBeats: 0.02 },
        },
        {
            // Comped from 12, pass 2 enters at 7.02 s, read at 60 BPM.
            name: 'pass 2 comped from after the drop',
            tempoChanges: dropTo60At(10),
            state: lane([pass('pass-2', [8, 16], 8.04, -5.96)], 'pass-2', 12, 16),
            clip: insideLoop,
            entry: { startBeat: 12, audioOffsetBeats: 7.02 },
        },
        {
            // Begun at the loop start, 8, with the drop at 12 inside the loop
            // (capture from 3.98 s, the clip on its origin at 7.96). Comped
            // from 13, pass 2 enters at 9.02 s, read at 60 BPM.
            name: 'pass 2 of a recording begun at the loop start, comped from after the drop',
            tempoChanges: dropTo60At(12),
            state: lane([pass('pass-2', [8, 16], 12.04, 0.04)], 'pass-2', 13, 16),
            clip: recording(7.96, 24),
            entry: { startBeat: 13, audioOffsetBeats: 9.02 },
        },
    ])('enter $name where the capture recorded it', ({ tempoChanges, state, clip, entry }) => {
        tempoMapStore.set({ changes: tempoChanges });
        takeLaneStore.set(state);

        const live = resolveClipsWithComping('t1', [clip]);
        const offline = resolveTrackClipsWithComping('t1', [clip], state);

        expect(offline).toEqual(live);
        const entered = offline.find((fragment) => fragment.startBeat === entry.startBeat);
        expect(entered?.audioOffsetBeats).toBeCloseTo(entry.audioOffsetBeats, 9);
    });

    it('leaves a fragment on its clip’s own offset byte-identical to the clip', () => {
        tempoMapStore.set({ changes: dropTo60At(10) });
        const state = lane([pass('pass-2', [8, 16], 8.04, -5.96)], 'pass-2', 12, 16);
        takeLaneStore.set(state);

        const live = resolveClipsWithComping('t1', [insideLoop]);
        const offline = resolveTrackClipsWithComping('t1', [insideLoop], state);

        // The clip shows through from its own start, [8,12).
        const { regionStartBeat, regionEndBeat, sourceStartBeat, ...gap } = live[0]!;
        expect([regionStartBeat, regionEndBeat, sourceStartBeat]).toEqual([8, 12, 8]);
        expect({ ...gap, endBeat: insideLoop.endBeat }).toStrictEqual(insideLoop);
        expect(offline[0]?.audioOffsetBeats).toBe(insideLoop.audioOffsetBeats);
    });
});

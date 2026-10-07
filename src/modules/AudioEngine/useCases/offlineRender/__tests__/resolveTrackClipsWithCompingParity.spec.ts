import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, takeLaneStore, type TakeLaneStoreState } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';

import { resolveTrackClipsWithComping } from '../resolveTrackClipsWithComping';

type Take = TakeLaneStoreState['lanes'][number]['takes'][number];

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

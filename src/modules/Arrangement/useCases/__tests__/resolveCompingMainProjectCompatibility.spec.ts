import { describe, expect, it, vi } from 'vitest';

import { type TakeLane } from '../../models/TakeLane';
import { type Clip } from '../../models/Track';
import { sanitize_take_lane_store_state, type TakeLaneStoreState } from '../../stores/takeLaneStore';
import { resolveClipsWithComping } from '../resolveComping';

const mocks = vi.hoisted(() => ({
    takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
}));

vi.mock('../../stores/takeLaneStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../stores/takeLaneStore')>()),
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        set: vi.fn(),
    },
}));

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

/** The comp fragments a take lane resolved to before `passStartBeats` existed, as main's resolver computed them. */
function resolveCompFragmentsAsMain(lane: TakeLane, clip: Clip) {
    return lane.activeCompRegions.flatMap((region) => {
        const take = lane.takes.find((candidate) => candidate.id === region.takeId);
        if (!take || take.clipId !== clip.id) {
            return [];
        }
        const overlapStart = Math.max(region.startBeat, clip.startBeat);
        const overlapEnd = Math.min(region.endBeat, clip.endBeat);
        if (overlapStart >= overlapEnd) {
            return [];
        }
        const mediaOriginBeat = clip.startBeat - (take.sourceOffsetBeats ?? 0);
        return [
            {
                startBeat: overlapStart,
                endBeat: overlapEnd,
                audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + overlapStart - mediaOriginBeat,
                sourceStartBeat: mediaOriginBeat,
            },
        ];
    });
}

/** A loop recording's lanes exactly as main saves them: wrap takes carry only their offset. */
const savedByMain = {
    lanes: [
        {
            id: 'lane-1',
            trackId: 't1',
            takes: [
                { id: 'take-1', clipId: 'rec', name: 'Take 1', startBeat: 1, endBeat: 9, selected: false },
                {
                    id: 'pass-1',
                    clipId: 'rec',
                    name: 'Take 2',
                    startBeat: 2,
                    endBeat: 6,
                    selected: false,
                    sourceOffsetBeats: 1,
                },
                {
                    id: 'pass-2',
                    clipId: 'rec',
                    name: 'Take 3',
                    startBeat: 2,
                    endBeat: 6,
                    selected: false,
                    sourceOffsetBeats: 5,
                },
            ],
            activeCompRegions: [
                { startBeat: 2, endBeat: 3, takeId: 'pass-1' },
                { startBeat: 3, endBeat: 6, takeId: 'pass-2' },
            ],
        },
    ],
};

describe('resolveClipsWithComping on a project saved before pass placement existed', () => {
    it.each([
        { name: 'as recorded', clip: recording(1, 10) },
        { name: 'moved', clip: recording(5, 14) },
        { name: 'slipped', clip: recording(1, 10, 0.5) },
        { name: 'start trimmed past a region', clip: recording(2.5, 10, 1.5) },
    ])('plays every comped pass exactly as main did when the clip is $name', ({ clip }) => {
        const loaded = sanitize_take_lane_store_state(savedByMain);
        expect(loaded).toEqual(savedByMain);
        mocks.takeLaneStoreValue.value = loaded;

        const resolved = resolveClipsWithComping('t1', [clip]);
        const comped = resolved
            .filter((fragment) => fragment.sourceStartBeat !== clip.startBeat)
            .map(({ startBeat, endBeat, audioOffsetBeats, sourceStartBeat }) => ({
                startBeat,
                endBeat,
                audioOffsetBeats: audioOffsetBeats ?? 0,
                sourceStartBeat,
            }));

        expect(comped).toEqual(resolveCompFragmentsAsMain(loaded.lanes[0]!, clip));
    });

    // Every fragment main's resolver produces for these clips, worked by hand
    // from its law: a comped fragment enters the media at the clip's own offset
    // plus its distance from `clip.startBeat - sourceOffsetBeats`, a gap at the
    // clip's own offset plus its distance from the clip start.
    it.each([
        {
            name: 'as recorded',
            clip: recording(1, 10),
            asMain: [
                { startBeat: 1, endBeat: 2, audioOffsetBeats: 0, sourceStartBeat: 1 },
                { startBeat: 2, endBeat: 3, audioOffsetBeats: 2, sourceStartBeat: 0 },
                { startBeat: 3, endBeat: 6, audioOffsetBeats: 7, sourceStartBeat: -4 },
                { startBeat: 6, endBeat: 10, audioOffsetBeats: 5, sourceStartBeat: 1 },
            ],
        },
        {
            name: 'start trimmed past a region',
            clip: recording(2.5, 10, 1.5),
            asMain: [
                { startBeat: 2.5, endBeat: 3, audioOffsetBeats: 2.5, sourceStartBeat: 1.5 },
                { startBeat: 3, endBeat: 6, audioOffsetBeats: 7, sourceStartBeat: -2.5 },
                { startBeat: 6, endBeat: 10, audioOffsetBeats: 5, sourceStartBeat: 2.5 },
            ],
        },
    ])('resolves every fragment main resolved when the clip is $name', ({ clip, asMain }) => {
        mocks.takeLaneStoreValue.value = sanitize_take_lane_store_state(savedByMain);

        const resolved = resolveClipsWithComping('t1', [clip]).map(
            ({ startBeat, endBeat, audioOffsetBeats, sourceStartBeat }) => ({
                startBeat,
                endBeat,
                audioOffsetBeats: audioOffsetBeats ?? 0,
                sourceStartBeat,
            })
        );

        expect(resolved).toEqual(asMain);
    });
});

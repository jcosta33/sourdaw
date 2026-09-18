import { describe, expect, it } from 'vitest';

import { type TakeLane } from '../../models/TakeLane';
import {
    appendTakeLaneWriteJournal,
    applyTakeLaneCompRegionPatch,
    captureTakeLaneWriteJournal,
    replayTakeLaneWriteJournal,
    runWithTakeLaneWriteIntent,
    type TakeLaneCompRegionPatch,
} from '../takeLaneWriteJournal';

const firstLane: TakeLane = {
    id: 'lane-1',
    trackId: 'track-1',
    automationLaneId: 'automation-1',
    takes: [
        {
            id: 'take-a',
            clipId: 'clip-a',
            name: 'A',
            startBeat: 0,
            endBeat: 8,
            selected: true,
        },
        {
            id: 'take-b',
            clipId: 'clip-b',
            name: 'B',
            startBeat: 0,
            endBeat: 8,
            selected: false,
        },
        {
            id: 'take-c',
            clipId: 'clip-c',
            name: 'C',
            startBeat: 0,
            endBeat: 8,
            selected: false,
        },
    ],
    activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: 'take-a' }],
};

const secondLane: TakeLane = {
    id: 'lane-2',
    trackId: 'track-2',
    takes: [
        {
            id: 'take-d',
            clipId: 'clip-d',
            name: 'D',
            startBeat: 0,
            endBeat: 8,
            selected: true,
            sourceOffsetBeats: 1,
        },
    ],
    activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: 'take-d' }],
};

const intervalPatch: TakeLaneCompRegionPatch = {
    laneId: 'lane-1',
    trackId: 'track-1',
    startBeat: 2,
    endBeat: 4,
    expected: [{ startBeat: 2, endBeat: 4, takeId: 'take-a' }],
    replacement: [{ startBeat: 2, endBeat: 4, takeId: 'take-b' }],
};

describe('takeLaneWriteJournal', () => {
    it('replays only actual field and membership deltas over unrelated authoritative edits', () => {
        const before = { lanes: [structuredClone(firstLane), structuredClone(secondLane)] };
        const next = {
            lanes: [
                {
                    ...structuredClone(firstLane),
                    automationLaneId: undefined,
                    takes: firstLane.takes.map((take) => {
                        if (take.id === 'take-a') {
                            return { ...take, name: 'A local', sourceOffsetBeats: 2 };
                        }
                        return structuredClone(take);
                    }),
                },
                structuredClone(secondLane),
            ],
        };
        delete next.lanes[0]!.automationLaneId;
        const journal = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: next });
        const authority = {
            lanes: [
                {
                    ...structuredClone(firstLane),
                    activeCompRegions: [
                        { startBeat: 0, endBeat: 5, takeId: 'take-a' },
                        { startBeat: 5, endBeat: 6, takeId: 'take-c' },
                        { startBeat: 6, endBeat: 8, takeId: 'take-a' },
                    ],
                },
                {
                    ...structuredClone(secondLane),
                    takes: [{ ...structuredClone(secondLane.takes[0]!), name: 'D authoritative' }],
                },
            ],
        };

        const replay = replayTakeLaneWriteJournal(authority, journal);

        expect(replay).toMatchObject({ status: 'applied' });
        if (replay.status !== 'applied') {
            throw new Error('Expected the field delta to replay');
        }
        expect(replay.value?.lanes[0]).not.toHaveProperty('automationLaneId');
        expect(replay.value?.lanes[0]?.takes[0]).toMatchObject({ name: 'A local', sourceOffsetBeats: 2 });
        expect(replay.value?.lanes[0]?.activeCompRegions).toEqual(authority.lanes[0]?.activeCompRegions);
        expect(replay.value?.lanes[1]?.takes[0]?.name).toBe('D authoritative');
    });

    it('guards an untagged active-region replacement as one full owned array', () => {
        const before = { lanes: [structuredClone(firstLane)] };
        const next = {
            lanes: [
                {
                    ...structuredClone(firstLane),
                    activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: 'take-b' }],
                },
            ],
        };
        const journal = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: next });
        const authority = {
            lanes: [
                {
                    ...structuredClone(firstLane),
                    activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: 'take-c' }],
                },
            ],
        };

        expect(replayTakeLaneWriteJournal(authority, journal)).toEqual({ status: 'conflict' });
    });

    it('keeps a later keyed lane removal final after interval replay', () => {
        const before = { lanes: [structuredClone(firstLane), structuredClone(secondLane)] };
        const afterInterval = applyTakeLaneCompRegionPatch(before, intervalPatch);
        if (!afterInterval) {
            throw new Error('Expected interval fixture to apply');
        }
        const intervalJournal = runWithTakeLaneWriteIntent({ kind: 'comp-region-interval', patch: intervalPatch }, () =>
            captureTakeLaneWriteJournal({ beforeValue: before, nextValue: afterInterval })
        );
        const afterRemoval = { lanes: [structuredClone(secondLane)] };
        const removalJournal = captureTakeLaneWriteJournal({
            beforeValue: afterInterval,
            nextValue: afterRemoval,
        });
        const journal = appendTakeLaneWriteJournal(intervalJournal, removalJournal);

        expect(replayTakeLaneWriteJournal(before, journal)).toEqual({
            status: 'applied',
            value: afterRemoval,
        });
    });

    it('keeps an explicit final whole-state replacement and ignores object key order', () => {
        const before = { lanes: [structuredClone(firstLane)] };
        const reorderedBefore = {
            lanes: [
                {
                    activeCompRegions: structuredClone(firstLane.activeCompRegions),
                    takes: structuredClone(firstLane.takes),
                    automationLaneId: firstLane.automationLaneId,
                    trackId: firstLane.trackId,
                    id: firstLane.id,
                },
            ],
        };
        const replacement = { lanes: [structuredClone(secondLane)] };
        const journal = runWithTakeLaneWriteIntent({ kind: 'replace-state' }, () =>
            captureTakeLaneWriteJournal({ beforeValue: before, nextValue: replacement })
        );

        expect(replayTakeLaneWriteJournal(reorderedBefore, journal)).toEqual({
            status: 'applied',
            value: replacement,
        });
    });

    it('replays tagged, untagged, and whole-state writes in their authored order', () => {
        const before = { lanes: [structuredClone(firstLane), structuredClone(secondLane)] };
        const afterInterval = applyTakeLaneCompRegionPatch(before, intervalPatch);
        if (!afterInterval) {
            throw new Error('Expected interval fixture to apply');
        }
        const intervalJournal = runWithTakeLaneWriteIntent({ kind: 'comp-region-interval', patch: intervalPatch }, () =>
            captureTakeLaneWriteJournal({ beforeValue: before, nextValue: afterInterval })
        );
        const afterUntaggedSelection = {
            lanes: afterInterval.lanes.map((lane) => {
                if (lane.id === 'lane-1') {
                    return {
                        ...lane,
                        activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: 'take-c' }],
                    };
                }
                return lane;
            }),
        };
        const selectionJournal = captureTakeLaneWriteJournal({
            beforeValue: afterInterval,
            nextValue: afterUntaggedSelection,
        });
        const replacement = { lanes: [structuredClone(secondLane)] };
        const replacementJournal = runWithTakeLaneWriteIntent({ kind: 'replace-state' }, () =>
            captureTakeLaneWriteJournal({ beforeValue: afterUntaggedSelection, nextValue: replacement })
        );
        const journal = appendTakeLaneWriteJournal(
            appendTakeLaneWriteJournal(intervalJournal, selectionJournal),
            replacementJournal
        );

        expect(replayTakeLaneWriteJournal(before, journal)).toEqual({
            status: 'applied',
            value: replacement,
        });
        const authorityWithOutsideSelection = {
            lanes: before.lanes.map((lane) => {
                if (lane.id === 'lane-1') {
                    return {
                        ...lane,
                        activeCompRegions: [
                            { startBeat: 0, endBeat: 5, takeId: 'take-a' },
                            { startBeat: 5, endBeat: 6, takeId: 'take-c' },
                            { startBeat: 6, endBeat: 8, takeId: 'take-a' },
                        ],
                    };
                }
                return lane;
            }),
        };
        expect(replayTakeLaneWriteJournal(authorityWithOutsideSelection, journal)).toEqual({ status: 'conflict' });
    });
});

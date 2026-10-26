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
    it('moves a frozen MIDI source phase without replacing a peer-edited sibling row', () => {
        const source = {
            sourceClipId: 'clip-a',
            rows: {
                notes: {
                    present: true as const,
                    value: [
                        { id: 'note-a', pitch: 60, startBeat: 1, duration: 1, velocity: 90 },
                        { id: 'note-b', pitch: 64, startBeat: 2, duration: 1, velocity: 90 },
                    ],
                },
                controlChanges: { present: true as const, value: [] },
                pitchBends: { present: true as const, value: [] },
            },
            sourceEntryBeat: 0,
            sourceEndBeat: 4,
            phaseHeadBeat: 0,
            passLengthBeats: 4,
        };
        const before = { lanes: [{ ...structuredClone(firstLane), takes: [{ ...firstLane.takes[0]!, midiSource: source }] }] };
        const next = structuredClone(before);
        next.lanes[0]!.takes[0]!.midiSource.phaseHeadBeat = -2;
        const peer = structuredClone(before);
        peer.lanes[0]!.takes[0]!.midiSource.rows.notes.value[1]!.velocity = 111;

        const journal = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: next });
        const replay = replayTakeLaneWriteJournal(peer, journal);

        expect(replay.status).toBe('applied');
        if (replay.status !== 'applied') {
            return;
        }
        expect(replay.value?.lanes[0]?.takes[0]?.midiSource?.phaseHeadBeat).toBe(-2);
        expect(replay.value?.lanes[0]?.takes[0]?.midiSource?.rows.notes.value[1]?.velocity).toBe(111);
    });

    it('replays only actual field and membership deltas over unrelated authoritative edits', () => {
        const before = { lanes: [structuredClone(firstLane), structuredClone(secondLane)] };
        const next = {
            lanes: [
                {
                    ...structuredClone(firstLane),
                    automationLaneId: undefined,
                    takes: firstLane.takes.map((take) => {
                        if (take.id === 'take-a') {
                            return {
                                ...take,
                                name: 'A local',
                                sourceOffsetBeats: 2,
                                passAnchorSeconds: -1.5,
                                passDepthSeconds: 1,
                            };
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
        expect(replay.value?.lanes[0]?.takes[0]).toMatchObject({
            name: 'A local',
            sourceOffsetBeats: 2,
            passAnchorSeconds: -1.5,
            passDepthSeconds: 1,
        });
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

describe('finite captured pass field ownership', () => {
    it('retains the exclusive source end through journal replay beside a peer edit', () => {
        const take = {
            ...firstLane.takes[0]!,
            sourceOffsetBeats: 0,
            passAnchorSeconds: 0,
            passDepthSeconds: 0,
            passSourceEndSeconds: 1,
        };
        const before = { lanes: [{ ...firstLane, takes: [take, firstLane.takes[1]!] }] };
        const next = {
            lanes: [{ ...before.lanes[0]!, takes: [{ ...take, passSourceEndSeconds: 2 }, firstLane.takes[1]!] }],
        };
        const journal = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: next });
        expect(journal).toContainEqual({
            kind: 'take-optional-number-field',
            laneId: firstLane.id,
            takeId: take.id,
            field: 'passSourceEndSeconds',
            expected: { present: true, value: 1 },
            replacement: { present: true, value: 2 },
        });
        const peer = structuredClone(before);
        peer.lanes[0]!.takes[1]!.name = 'Peer phrase';
        const replay = replayTakeLaneWriteJournal(peer, journal);
        expect(replay.status).toBe('applied');
        if (replay.status !== 'applied') {
            throw new Error('Expected finite pass replay');
        }
        expect(replay.value!.lanes[0]!.takes[0]!.passSourceEndSeconds).toBe(2);
        expect(replay.value!.lanes[0]!.takes[1]!.name).toBe('Peer phrase');
        const conflict = structuredClone(before);
        conflict.lanes[0]!.takes[0]!.passSourceEndSeconds = 1.5;
        expect(replayTakeLaneWriteJournal(conflict, journal).status).toBe('conflict');
    });
});

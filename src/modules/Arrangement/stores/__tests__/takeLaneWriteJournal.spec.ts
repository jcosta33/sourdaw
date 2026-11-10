import { describe, expect, it } from 'vitest';

import { type MidiTakeSource, type TakeLane } from '../../models/TakeLane';
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
    it('replays a restored row before its captured neighbour without replacing a peer edit', () => {
        const peerRow = { id: 'peer', pitch: 64, startBeat: 2, duration: 1, velocity: 90 };
        const restoredRow = { id: 'restored', pitch: 60, startBeat: 1, duration: 1, velocity: 90 };
        const before = {
            lanes: [
                {
                    ...structuredClone(firstLane),
                    takes: [
                        {
                            ...firstLane.takes[0]!,
                            midiSource: {
                                sourceClipId: 'clip-a',
                                sourceEntryBeat: 0,
                                sourceEndBeat: 4,
                                phaseHeadBeat: 0,
                                passLengthBeats: 4,
                                rows: {
                                    notes: { present: true, value: [peerRow] },
                                    controlChanges: { present: true, value: [] },
                                    pitchBends: { present: true, value: [] },
                                },
                            },
                        },
                    ],
                },
            ],
        };
        const next = structuredClone(before);
        next.lanes[0]!.takes[0]!.midiSource.rows.notes.value.unshift(restoredRow);
        const peer = structuredClone(before);
        peer.lanes[0]!.takes[0]!.midiSource.rows.notes.value[0]!.velocity = 111;
        const journal = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: next });
        expect(journal).toHaveLength(1);
        expect(journal[0]?.kind).toBe('take-midi-source-note-row');
        const result = replayTakeLaneWriteJournal(peer, journal);
        expect(result.status).toBe('applied');
        if (result.status !== 'applied') {
            throw new Error('Expected keyed row insertion');
        }
        expect(result.value?.lanes[0]?.takes[0]?.midiSource?.rows.notes.value).toEqual([
            restoredRow,
            { ...peerRow, velocity: 111 },
        ]);
        const missing = structuredClone(peer);
        missing.lanes[0]!.takes[0]!.midiSource.rows.notes.value = [];
        expect(replayTakeLaneWriteJournal(missing, journal).status).toBe('conflict');
    });

    it('replays a frozen note edit beside a peer edit to another original row', () => {
        const source = {
            sourceClipId: 'clip-a',
            rows: {
                notes: {
                    present: true as const,
                    value: [
                        { id: 'edited', pitch: 60, startBeat: 1, duration: 1, velocity: 90 },
                        { id: 'peer', pitch: 64, startBeat: 2, duration: 1, velocity: 90 },
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
        const before = {
            lanes: [{ ...structuredClone(firstLane), takes: [{ ...firstLane.takes[0]!, midiSource: source }] }],
        };
        const next = structuredClone(before);
        next.lanes[0]!.takes[0]!.midiSource.rows.notes.value[0]!.velocity = 70;
        const peer = structuredClone(before);
        peer.lanes[0]!.takes[0]!.midiSource.rows.notes.value[1]!.velocity = 111;

        const journal = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: next });
        const replay = replayTakeLaneWriteJournal(peer, journal);
        expect(replay.status).toBe('applied');
        if (replay.status !== 'applied') {
            return;
        }
        expect(replay.value?.lanes[0]?.takes[0]?.midiSource?.rows.notes.value.map((note) => note.velocity)).toEqual([
            70, 111,
        ]);
        const conflicting = structuredClone(before);
        conflicting.lanes[0]!.takes[0]!.midiSource.rows.notes.value[0]!.velocity = 112;
        expect(replayTakeLaneWriteJournal(conflicting, journal).status).toBe('conflict');
    });

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
        const before = {
            lanes: [
                {
                    ...structuredClone(firstLane),
                    takes: [{ ...firstLane.takes[0]!, midiSource: source, recordingPassIndex: 0 }],
                },
            ],
        };
        const next = structuredClone(before);
        next.lanes[0]!.takes[0]!.midiSource.phaseHeadBeat = -2;
        next.lanes[0]!.takes[0]!.recordingPassIndex = 1;
        const peer = structuredClone(before);
        peer.lanes[0]!.takes[0]!.midiSource.rows.notes.value[1]!.velocity = 111;

        const journal = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: next });
        const replay = replayTakeLaneWriteJournal(peer, journal);

        expect(replay.status).toBe('applied');
        if (replay.status !== 'applied') {
            return;
        }
        expect(replay.value?.lanes[0]?.takes[0]?.midiSource?.phaseHeadBeat).toBe(-2);
        expect(replay.value?.lanes[0]?.takes[0]?.recordingPassIndex).toBe(1);
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

describe('comp region source-only journal ownership', () => {
    const source = {
        startBeat: 0,
        audioOffsetSeconds: 4,
        audioLoopStartSeconds: 4,
        audioLoopPassEntrySeconds: 4,
        audioLoopPassOriginBeat: 0,
        loopOriginBeat: 0,
        loopLength: 8,
    };
    const before = { lanes: [structuredClone(firstLane)] };
    const after = {
        lanes: [
            {
                ...firstLane,
                activeCompRegions: firstLane.activeCompRegions.map((region) => ({ ...region, audioSource: source })),
            },
        ],
    };

    it('emits one keyed source-presence CAS and retains independent authoritative comp rows and take facets', () => {
        const journal = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: after });
        expect(journal).toEqual([
            {
                kind: 'comp-region-audio-source',
                laneId: 'lane-1',
                takeId: 'take-a',
                startBeat: 0,
                endBeat: 8,
                expected: { present: false },
                replacement: { present: true, value: source },
            },
        ]);
        const peer = {
            ...firstLane,
            takes: firstLane.takes.toReversed().map((take) => ({ ...take, name: 'Peer', selected: !take.selected })),
            activeCompRegions: [...firstLane.activeCompRegions, { startBeat: 10, endBeat: 12, takeId: 'take-b' }],
        };
        const projected = replayTakeLaneWriteJournal({ lanes: [peer] }, journal);
        expect(projected).toEqual({
            status: 'applied',
            value: {
                lanes: [
                    {
                        ...peer,
                        activeCompRegions: [
                            { ...firstLane.activeCompRegions[0]!, audioSource: source },
                            peer.activeCompRegions[1]!,
                        ],
                    },
                ],
            },
        });
        if (projected.status !== 'applied') {
            throw new Error('Expected region source replay');
        }
        const inverse = captureTakeLaneWriteJournal({ beforeValue: after, nextValue: before });
        const restored = replayTakeLaneWriteJournal(projected.value, inverse);
        expect(restored).toEqual({ status: 'applied', value: { lanes: [peer] } });
        if (restored.status !== 'applied') {
            throw new Error('Expected exact source absence');
        }
        expect(Object.hasOwn(restored.value!.lanes[0]!.activeCompRegions[0]!, 'audioSource')).toBe(false);
    });

    it.each(['missing', 'duplicate', 'geometry', 'source'] as const)(
        'refuses %s owned source rows without rebuilding them',
        (change) => {
            const journal = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: after });
            const peer = structuredClone(firstLane);
            if (change === 'missing') {
                peer.activeCompRegions = [];
            }
            if (change === 'duplicate') {
                peer.activeCompRegions.push(structuredClone(peer.activeCompRegions[0]!));
            }
            if (change === 'geometry') {
                peer.activeCompRegions[0]!.endBeat = 7;
            }
            if (change === 'source') {
                peer.activeCompRegions[0]!.audioSource = { ...source, audioOffsetSeconds: 5 };
            }
            const original = structuredClone(peer);
            expect(replayTakeLaneWriteJournal({ lanes: [peer] }, journal)).toEqual({ status: 'conflict' });
            expect(peer).toEqual(original);
        }
    );

    it('retains whole-array ownership for real geometry or ordering changes', () => {
        const next = {
            lanes: [
                { ...after.lanes[0]!, activeCompRegions: [{ ...after.lanes[0]!.activeCompRegions[0]!, endBeat: 7 }] },
            ],
        };
        expect(captureTakeLaneWriteJournal({ beforeValue: before, nextValue: next })).toEqual([
            {
                kind: 'replace-comp-regions',
                laneId: firstLane.id,
                expected: before.lanes[0]!.activeCompRegions,
                replacement: next.lanes[0]!.activeCompRegions,
            },
        ]);
    });
});

describe('frozen MIDI row replay ownership', () => {
    const source = {
        sourceClipId: 'clip-a',
        rows: {
            notes: {
                present: true,
                value: [
                    { id: 'note-a', pitch: 60, startBeat: 1, duration: 1, velocity: 90 },
                    { id: 'note-b', pitch: 64, startBeat: 2, duration: 1, velocity: 90 },
                ],
            },
            controlChanges: {
                present: true,
                value: [
                    { id: 'cc-a', controller: 1, value: 30, channel: 0, beat: 1 },
                    { id: 'cc-b', controller: 1, value: 40, channel: 0, beat: 2 },
                ],
            },
            pitchBends: {
                present: true,
                value: [
                    { id: 'bend-a', value: 2000, channel: 0, beat: 1 },
                    { id: 'bend-b', value: 0, channel: 0, beat: 2 },
                ],
            },
        },
        sourceEntryBeat: 0,
        sourceEndBeat: 4,
        phaseHeadBeat: 0,
        passLengthBeats: 4,
    } satisfies MidiTakeSource;
    const before = { lanes: [{ ...firstLane, takes: [{ ...firstLane.takes[0]!, midiSource: source }] }] };

    it.each(['notes', 'controlChanges', 'pitchBends'] as const)(
        'replays a %s row beside a peer row and refuses an owned-row change without partial writes',
        (slot) => {
            const next = structuredClone(before);
            const peer = structuredClone(before);
            const conflict = structuredClone(before);
            if (slot === 'notes') {
                next.lanes[0]!.takes[0]!.midiSource.rows.notes.value[0]!.velocity = 70;
                peer.lanes[0]!.takes[0]!.midiSource.rows.notes.value[1]!.velocity = 110;
                conflict.lanes[0]!.takes[0]!.midiSource.rows.notes.value[0]!.velocity = 120;
            } else {
                next.lanes[0]!.takes[0]!.midiSource.rows[slot].value[0]!.value = 60;
                peer.lanes[0]!.takes[0]!.midiSource.rows[slot].value[1]!.value = 70;
                conflict.lanes[0]!.takes[0]!.midiSource.rows[slot].value[0]!.value = 80;
            }
            const journal = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: next });
            const replay = replayTakeLaneWriteJournal(peer, journal);
            expect(replay.status).toBe('applied');
            if (replay.status !== 'applied') {
                throw new Error('Expected a disjoint frozen-row replay');
            }
            expect(replay.value?.lanes[0]?.takes[0]?.midiSource?.rows[slot].value).toEqual([
                next.lanes[0]!.takes[0]!.midiSource.rows[slot].value[0],
                peer.lanes[0]!.takes[0]!.midiSource.rows[slot].value[1],
            ]);
            next.lanes[0]!.takes[0]!.name = 'Local name';
            const nameAndRow = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: next });
            const untouched = structuredClone(conflict);
            expect(replayTakeLaneWriteJournal(conflict, nameAndRow)).toEqual({ status: 'conflict' });
            expect(conflict).toEqual(untouched);
        }
    );

    it.each(['two rows', 'mixed slots', 'phase and row'] as const)(
        'keeps %s under whole-source authority when a peer changed another frozen row',
        (change) => {
            const next = structuredClone(before);
            next.lanes[0]!.takes[0]!.midiSource.rows.notes.value[0]!.velocity = 70;
            if (change === 'two rows') {
                next.lanes[0]!.takes[0]!.midiSource.rows.notes.value[1]!.velocity = 80;
            } else if (change === 'mixed slots') {
                next.lanes[0]!.takes[0]!.midiSource.rows.pitchBends.value[0]!.value = 4000;
            } else {
                next.lanes[0]!.takes[0]!.midiSource.phaseHeadBeat = -2;
            }
            const journal = captureTakeLaneWriteJournal({ beforeValue: before, nextValue: next });
            expect(replayTakeLaneWriteJournal(before, journal)).toEqual({ status: 'applied', value: next });
            const peer = structuredClone(before);
            peer.lanes[0]!.takes[0]!.midiSource.rows.controlChanges.value[1]!.value = 100;
            const untouched = structuredClone(peer);
            expect(replayTakeLaneWriteJournal(peer, journal)).toEqual({ status: 'conflict' });
            expect(peer).toEqual(untouched);
        }
    );
});

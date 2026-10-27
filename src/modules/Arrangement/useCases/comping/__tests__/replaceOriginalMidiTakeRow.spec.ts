import { afterEach, describe, expect, it } from 'vitest';

import { takeLaneStore } from '../../../stores/takeLaneStore';

import { replaceOriginalMidiTakeRow } from '../replaceOriginalMidiTakeRow';

const original = { id: 'note-1', pitch: 60, startBeat: 5.5, duration: 1, velocity: 90 };
const peer = { id: 'note-2', pitch: 64, startBeat: 6.5, duration: 1, velocity: 80 };
const source = {
    sourceClipId: 'original-clip',
    sourceEntryBeat: 5,
    sourceEndBeat: 9,
    phaseHeadBeat: 0,
    passLengthBeats: 4,
    rows: {
        notes: { present: true as const, value: [original, peer] },
        controlChanges: { present: true as const, value: [] },
        pitchBends: { present: true as const, value: [] },
    },
};

describe('replaceOriginalMidiTakeRow', () => {
    const before = takeLaneStore.value;
    afterEach(() => takeLaneStore.set(before));

    it('updates every frozen fragment with one original row id and preserves sibling rows', () => {
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    activeCompRegions: [],
                    takes: [
                        {
                            id: 'selected',
                            clipId: 'left',
                            name: 'Selected',
                            selected: true,
                            startBeat: 0,
                            endBeat: 4,
                            midiSource: structuredClone(source),
                        },
                        {
                            id: 'unselected',
                            clipId: 'right',
                            name: 'Unselected',
                            selected: false,
                            startBeat: 4,
                            endBeat: 8,
                            midiSource: { ...structuredClone(source), phaseHeadBeat: 4 },
                        },
                    ],
                },
            ],
        });
        const edited = { ...original, velocity: 71 };
        const owner = {
            laneId: 'lane-1',
            takeId: 'selected',
            sourceClipId: 'original-clip',
            rowId: original.id,
            expectedSlotPresent: true,
            replacementSlotPresent: true,
        };
        replaceOriginalMidiTakeRow({ ...owner, rowKind: 'note', expected: original, replacement: edited });
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.midiSource?.rows.notes.value)).toEqual([
            [edited, peer],
            [edited, peer],
        ]);

        const beforeRefusal = structuredClone(takeLaneStore.value);
        expect(() =>
            replaceOriginalMidiTakeRow({
                ...owner,
                rowKind: 'note',
                expected: original,
                replacement: { ...original, velocity: 50 },
            })
        ).toThrow('Frozen MIDI take row changed or owner is unavailable');
        expect(takeLaneStore.value).toEqual(beforeRefusal);
        expect(() =>
            replaceOriginalMidiTakeRow({
                ...owner,
                sourceClipId: 'other-source',
                rowKind: 'note',
                expected: edited,
                replacement: original,
            })
        ).toThrow('Frozen MIDI take row changed or owner is unavailable');
        expect(takeLaneStore.value).toEqual(beforeRefusal);
    });

    it('edits a legacy row without inventing a pass index and rejects present-undefined', () => {
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    activeCompRegions: [],
                    takes: [
                        {
                            id: 'selected',
                            clipId: 'left',
                            name: 'Selected',
                            selected: true,
                            startBeat: 0,
                            endBeat: 4,
                            recordingPassIndex: 1,
                            midiSource: structuredClone(source),
                        },
                    ],
                },
            ],
        });
        const owner = {
            laneId: 'lane-1',
            takeId: 'selected',
            sourceClipId: 'original-clip',
            rowId: peer.id,
            rowKind: 'note' as const,
            expectedSlotPresent: true,
            replacementSlotPresent: true,
        };
        const edited = { ...peer, pitch: 65 };
        replaceOriginalMidiTakeRow({ ...owner, expected: peer, replacement: edited });
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.midiSource?.rows.notes.value[1]).toEqual(edited);
        expect(Object.hasOwn(edited, 'recordingPassIndex')).toBe(false);

        const malformed = { ...peer, recordingPassIndex: undefined };
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    activeCompRegions: [],
                    takes: [
                        {
                            id: 'selected',
                            clipId: 'left',
                            name: 'Selected',
                            selected: true,
                            startBeat: 0,
                            endBeat: 4,
                            recordingPassIndex: 1,
                            midiSource: {
                                ...structuredClone(source),
                                rows: {
                                    ...structuredClone(source.rows),
                                    notes: { present: true, value: [original, malformed] },
                                },
                            },
                        },
                    ],
                },
            ],
        });
        const beforeRefusal = structuredClone(takeLaneStore.value);
        expect(() =>
            replaceOriginalMidiTakeRow({ ...owner, expected: malformed, replacement: { ...malformed, pitch: 65 } })
        ).toThrow('Frozen MIDI take row changed or owner is unavailable');
        expect(takeLaneStore.value).toEqual(beforeRefusal);
    });
});

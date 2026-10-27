import { from, load, save } from '@automerge/automerge';
import { describe, expect, it } from 'vitest';

import { decodeExactTakeLaneSnapshots } from '../takeLaneStore';

const source = {
    startBeat: -0,
    audioOffsetSeconds: -0,
    audioLoopStartSeconds: -0,
    audioLoopPassEntrySeconds: -0,
    audioLoopPassOriginBeat: -0,
    loopOriginBeat: -0,
    loopLength: 4,
};
const take = {
    id: 'take',
    clipId: 'clip',
    name: 'Take',
    startBeat: -0,
    endBeat: 8,
    selected: false,
    sourceOffsetBeats: -0,
};
const lane = {
    id: 'lane',
    trackId: 'audio',
    takes: [take],
    activeCompRegions: [{ startBeat: -0, endBeat: 1, takeId: 'take', audioSource: source }],
    // Valid per-clip order deliberately differs from global clip-id sorting.
    baseGapAudioSources: [
        { clipId: 'z', startBeat: 0, endBeat: 1, audioSource: source },
        { clipId: 'a', startBeat: 0, endBeat: 1, audioSource: source },
        { clipId: 'z', startBeat: 1, endBeat: 2, audioSource: source },
    ],
};

describe('exact and source-prefix take-lane projections', () => {
    it('canonicalizes frozen MIDI phase and row numbers only in the source prefix without dropping optional presence', () => {
        const midiTake = {
            ...take,
            midiSource: {
                sourceClipId: 'clip',
                rows: {
                    notes: {
                        present: true,
                        value: [
                            { id: 'note', pitch: 60, startBeat: -0, duration: 1, velocity: 90, pitchBend: undefined },
                        ],
                    },
                    controlChanges: { present: true, value: [] },
                    pitchBends: { present: true, value: [] },
                },
                sourceEntryBeat: -0,
                sourceEndBeat: 4,
                phaseHeadBeat: -0,
                passLengthBeats: 4,
            },
        };
        const midiLane = { ...lane, takes: [midiTake] };
        const exact = decodeExactTakeLaneSnapshots([midiLane]);
        const prefix = decodeExactTakeLaneSnapshots([midiLane], 'source-prefix');
        expect(Object.is(exact?.[0]?.takes[0]?.midiSource?.phaseHeadBeat, -0)).toBe(true);
        expect(Object.is(exact?.[0]?.takes[0]?.midiSource?.rows.notes.value[0]?.startBeat, -0)).toBe(true);
        expect(Object.is(prefix?.[0]?.takes[0]?.midiSource?.phaseHeadBeat, -0)).toBe(false);
        expect(Object.is(prefix?.[0]?.takes[0]?.midiSource?.rows.notes.value[0]?.startBeat, -0)).toBe(false);
        expect(Object.hasOwn(prefix?.[0]?.takes[0]?.midiSource?.rows.notes.value[0] ?? {}, 'pitchBend')).toBe(true);
    });

    it('keeps the former structured-clone number representation by default and canonicalizes only prefix reads', () => {
        const raw = from({ lanes: [lane] });
        const loaded = load<{ lanes: (typeof lane)[] }>(save(raw));
        expect(Object.is(loaded.lanes[0]?.takes[0]?.sourceOffsetBeats, -0)).toBe(true);
        for (const input of [[lane], raw.lanes, loaded.lanes]) {
            const exact = decodeExactTakeLaneSnapshots(input);
            expect(exact).toStrictEqual(structuredClone([lane]));
            expect(Object.is(exact?.[0]?.takes[0]?.sourceOffsetBeats, -0)).toBe(true);
            const canonical = decodeExactTakeLaneSnapshots(input, 'source-prefix');
            expect(canonical).toStrictEqual(JSON.parse(JSON.stringify([lane])));
            expect(Object.is(canonical?.[0]?.activeCompRegions[0]?.audioSource?.startBeat, -0)).toBe(false);
            expect(() => structuredClone(canonical)).not.toThrow();
            expect(canonical?.[0]?.baseGapAudioSources?.map((tile) => tile.clipId)).toEqual(['z', 'a', 'z']);
        }
    });

    it('keeps absent and explicitly empty gap arrays distinct and preserves lane/take ordering', () => {
        const absent = { id: 'absent', trackId: 'audio', takes: [], activeCompRegions: [] };
        const empty = { ...absent, id: 'empty', baseGapAudioSources: [] };
        for (const input of [[empty, absent], from({ lanes: [empty, absent] }).lanes]) {
            const result = decodeExactTakeLaneSnapshots(input, 'source-prefix');
            expect(result?.map((entry) => entry.id)).toEqual(['empty', 'absent']);
            expect(Object.hasOwn(result![0]!, 'baseGapAudioSources')).toBe(true);
            expect(Object.hasOwn(result![1]!, 'baseGapAudioSources')).toBe(false);
        }
        expect(decodeExactTakeLaneSnapshots([])).toEqual([]);
    });

    it('keeps exact-decoder undefined rejection and does not acquire inherited optional fields', () => {
        expect(decodeExactTakeLaneSnapshots([{ ...lane, automationLaneId: undefined }])).toBeNull();
        expect(decodeExactTakeLaneSnapshots([{ ...lane, baseGapAudioSources: undefined }])).toBeNull();
        expect(
            decodeExactTakeLaneSnapshots([{ ...lane, takes: [{ ...take, sourceOffsetBeats: undefined }] }])
        ).toBeNull();
        const inheritedTake = Object.assign(Object.create({ sourceOffsetBeats: 4 }), {
            id: 'take',
            clipId: 'clip',
            name: 'Take',
            startBeat: 0,
            endBeat: 8,
            selected: false,
        });
        const inherited = { ...lane, takes: [inheritedTake] };
        const result = decodeExactTakeLaneSnapshots([inherited]);
        expect(result).toStrictEqual(structuredClone([inherited]));
        expect(Object.hasOwn(result![0]!.takes[0]!, 'sourceOffsetBeats')).toBe(false);
    });
});

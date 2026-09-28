import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores';
import { prepareMidiGlobalTimeTransaction } from '#/modules/MIDI/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { resolveClipsWithComping } from '../../resolveComping';
import {
    setTimeOperationDependencies,
    type TimeOperationDependencies,
} from '../../timeOperations/timeOperationDependencies';
import { timeOperationStateCodec } from '../../timeOperations/timeOperationStateCodec';
import { executeSelectedTimeRangeDeletion } from '../executeSelectedTimeRangeDeletion';

const EMPTY_MIDI_STATE = {
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
};

const CANONICAL_TRACK_KINDS = ['audio', 'midi', 'bus', 'master', 'folder'] as const;
const TEST_OWNER_INVERSE_PLAN = {
    version: 1 as const,
    expected: { state: 'next' },
    replacement: { state: 'previous' },
};

type MidiPreparation = ReturnType<TimeOperationDependencies['prepareMidiGlobalTimeTransaction']>;
type TestMidiPreparation = Omit<MidiPreparation, 'inversePlan'> & {
    inversePlan?: Record<string, unknown> | null;
};
type TestMidiPreparer = (
    input: Parameters<TimeOperationDependencies['prepareMidiGlobalTimeTransaction']>[0]
) => TestMidiPreparation;

function noChangePreparation() {
    return {
        status: 'ready' as const,
        hasChanges: false,
        replayPlan: { version: 1 as const, notes: [] },
        inversePlan: null,
        apply: () => false,
        revert: () => false,
    };
}

function installMidiPreparation(prepareMidi: TestMidiPreparer): void {
    function prepareMidiWithInversePlan(
        input: Parameters<TimeOperationDependencies['prepareMidiGlobalTimeTransaction']>[0]
    ): MidiPreparation {
        const preparation = prepareMidi(input);
        let inversePlan: Record<string, unknown> | null = preparation.inversePlan ?? null;
        if (preparation.hasChanges && preparation.inversePlan === undefined) {
            inversePlan = TEST_OWNER_INVERSE_PLAN;
        }
        return {
            ...preparation,
            inversePlan,
        };
    }
    setTimeOperationDependencies({
        prepareAutomationTimeOperation: noChangePreparation,
        prepareAutomationTimeStateRestore: noChangePreparation,
        prepareMidiGlobalTimeTransaction: prepareMidiWithInversePlan,
        prepareMidiTimeStateRestore: noChangePreparation,
        prepareTimelineMapTimeOperation: noChangePreparation,
        prepareTimelineMapStateRestore: noChangePreparation,
    });
}

function installRealMidiPreparation(): void {
    installMidiPreparation(prepareMidiGlobalTimeTransaction);
}

function createClip(input: {
    id: string;
    trackId: string;
    startBeat: number;
    endBeat: number;
    type?: 'audio' | 'midi';
}) {
    const clipType = input.type ?? 'audio';
    return ClipDummy.create({
        id: input.id,
        trackId: input.trackId,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        type: clipType,
    });
}

function createTrack(
    id: string,
    clips: ReturnType<typeof createClip>[],
    kind: (typeof CANONICAL_TRACK_KINDS)[number] = 'audio'
) {
    return TrackDummy.create({ id, clips, kind });
}

function createDormantTrack(id: string, clips: ReturnType<typeof createClip>[]) {
    const track = createTrack(id, clips, 'folder');
    Object.defineProperty(track, 'kind', {
        configurable: true,
        enumerable: true,
        value: 'vca',
        writable: true,
    });
    return track;
}

function setArrangement(tracks: ReturnType<typeof createTrack>[]) {
    const state = {
        tracks,
        selectedTrackId: tracks[0]?.id ?? null,
        ghostClips: [
            createClip({
                id: 'ghost',
                trackId: 'ghost-owner',
                startBeat: 20,
                endBeat: 21,
            }),
        ],
    };
    trackStore.set(state);
    return state;
}

function requireApplied(result: ReturnType<typeof executeSelectedTimeRangeDeletion>) {
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') {
        throw new Error('Expected applied selected-range transaction');
    }
    return result;
}

function requireRecord(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Expected an object record');
    }
    return value as Record<string, unknown>;
}

describe('executeSelectedTimeRangeDeletion', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        trackStore.set({
            tracks: [],
            selectedTrackId: null,
            ghostClips: [],
        });
        midiStore.set(EMPTY_MIDI_STATE);
        takeLaneStore.set({ lanes: [] });
        installRealMidiPreparation();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4123-8123-123456789abc');
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
        takeLaneStore.set({ lanes: [] });
        vi.restoreAllMocks();
    });

    it('rejects a mixed eligible and dormant target set without applying an eligible subset', () => {
        const eligibleClip = createClip({
            id: 'eligible-clip',
            trackId: 'eligible',
            startBeat: 2,
            endBeat: 4,
        });
        const dormantClip = createClip({
            id: 'dormant-clip',
            trackId: 'dormant',
            startBeat: 2,
            endBeat: 4,
        });
        const eligible = createTrack('eligible', [eligibleClip]);
        const dormant = createDormantTrack('dormant', [dormantClip]);
        const originalState = setArrangement([eligible, dormant]);

        const result = executeSelectedTimeRangeDeletion({
            startBeat: 1,
            endBeat: 5,
            trackIds: ['eligible', 'dormant'],
        });

        expect(result.status).toBe('rejected');
        expect(trackStore.value).toBe(originalState);
        expect(eligible.clips).toEqual([eligibleClip]);
        expect(dormant.clips).toEqual([dormantClip]);
    });

    it('returns truthful no-change for an empty target set without stores, dependencies, or identity allocation', () => {
        setTimeOperationDependencies(null);
        trackStore.clear();
        midiStore.clear();
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        const result = executeSelectedTimeRangeDeletion({
            startBeat: 0,
            endBeat: 4,
            trackIds: [],
        });

        expect(result).toMatchObject({
            status: 'no-change',
            hasChanges: false,
            replayPlan: {
                version: 1,
                operation: {
                    type: 'delete-selected-time-range',
                    startBeat: 0,
                    endBeat: 4,
                    trackIds: [],
                },
                clips: [],
                midi: { version: 1, notes: [] },
            },
        });
        expect(randomUuid).not.toHaveBeenCalled();
        expect(trackStore.value).toBeNull();
        expect(midiStore.value).toBeNull();
    });

    it('rejects malformed range and target input before identity allocation or owner preparation', () => {
        const prepareMidi = vi.fn(prepareMidiGlobalTimeTransaction);
        installMidiPreparation(prepareMidi);
        const clip = createClip({ id: 'span', trackId: 'target', startBeat: 0, endBeat: 10 });
        const originalState = setArrangement([createTrack('target', [clip])]);
        const originalMidi = midiStore.value;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        const invalidInputs: unknown[] = [
            { startBeat: Number.NaN, endBeat: 4, trackIds: ['target'] },
            { startBeat: -1, endBeat: 4, trackIds: ['target'] },
            { startBeat: 4, endBeat: 4, trackIds: ['target'] },
            { startBeat: 4, endBeat: Number.POSITIVE_INFINITY, trackIds: ['target'] },
            { startBeat: 0, endBeat: 4, trackIds: [''] },
            { startBeat: 0, endBeat: 4, trackIds: ['target', 'target'] },
            { startBeat: 0, endBeat: 4, trackIds: 'target' },
        ];

        for (const input of invalidInputs) {
            const result: unknown = Reflect.apply(executeSelectedTimeRangeDeletion, undefined, [input]);
            expect(result).toMatchObject({ status: 'rejected', hasChanges: false });
        }

        expect(randomUuid).not.toHaveBeenCalled();
        expect(prepareMidi).not.toHaveBeenCalled();
        expect(trackStore.value).toBe(originalState);
        expect(midiStore.value).toBe(originalMidi);
    });

    it('rejects malformed store ownership and clip geometry before identity allocation', () => {
        const prepareMidi = vi.fn(prepareMidiGlobalTimeTransaction);
        installMidiPreparation(prepareMidi);
        const malformedClip = createClip({
            id: 'span',
            trackId: 'target',
            startBeat: 0,
            endBeat: 10,
        });
        Reflect.set(malformedClip, 'endBeat', Number.NaN);
        const originalState = setArrangement([createTrack('target', [malformedClip])]);
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        const result = executeSelectedTimeRangeDeletion({
            startBeat: 3,
            endBeat: 7,
            trackIds: ['target'],
        });

        expect(result.status).toBe('rejected');
        expect(randomUuid).not.toHaveBeenCalled();
        expect(prepareMidi).not.toHaveBeenCalled();
        expect(trackStore.value).toBe(originalState);
    });

    it('rejects non-finite computed offsets before identity allocation', () => {
        const clip = createClip({
            id: 'span',
            trackId: 'target',
            startBeat: 0,
            endBeat: Number.MAX_VALUE,
        });
        clip.audioOffsetBeats = Number.MAX_VALUE;
        const originalState = setArrangement([createTrack('target', [clip])]);
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        const result = executeSelectedTimeRangeDeletion({
            startBeat: 1,
            endBeat: Number.MAX_VALUE / 2,
            trackIds: ['target'],
        });

        expect(result.status).toBe('rejected');
        expect(randomUuid).not.toHaveBeenCalled();
        expect(trackStore.value).toBe(originalState);
    });

    it('passes a complete ordered ownership snapshot, including dormant owners, to MIDI', () => {
        const targetClip = createClip({
            id: 'drop',
            trackId: 'target',
            startBeat: 2,
            endBeat: 4,
            type: 'midi',
        });
        const otherClip = createClip({
            id: 'other-clip',
            trackId: 'other',
            startBeat: 8,
            endBeat: 10,
        });
        const dormantClip = createClip({
            id: 'dormant-clip',
            trackId: 'dormant',
            startBeat: 12,
            endBeat: 14,
        });
        setArrangement([
            createTrack('target', [targetClip]),
            createTrack('other', [otherClip]),
            createDormantTrack('dormant', [dormantClip]),
        ]);
        const prepareMidi = vi.fn(() => noChangePreparation());
        installMidiPreparation(prepareMidi);

        const result = executeSelectedTimeRangeDeletion({
            startBeat: 1,
            endBeat: 5,
            trackIds: ['target'],
        });

        requireApplied(result);
        expect(prepareMidi).toHaveBeenCalledWith({
            operation: {
                type: 'delete',
                startBeat: 1,
                endBeat: 5,
                splits: [],
                removeClipIds: ['drop'],
            },
            owners: [
                {
                    trackId: 'target',
                    eligible: true,
                    clips: [{ clipId: 'drop', startBeat: 2, endBeat: 4 }],
                },
                {
                    trackId: 'other',
                    eligible: true,
                    clips: [{ clipId: 'other-clip', startBeat: 8, endBeat: 10 }],
                },
                {
                    trackId: 'dormant',
                    eligible: false,
                    clips: [{ clipId: 'dormant-clip', startBeat: 12, endBeat: 14 }],
                },
            ],
        });
    });

    it('rejects orphan MIDI data without changing either owner', () => {
        const clip = createClip({
            id: 'drop',
            trackId: 'target',
            startBeat: 2,
            endBeat: 4,
            type: 'midi',
        });
        const originalState = setArrangement([createTrack('target', [clip])]);
        const orphanMidi = {
            notesByClipId: {
                orphan: [{ id: 'n-orphan', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        midiStore.set(orphanMidi);
        const originalMidi = midiStore.value;

        const result = executeSelectedTimeRangeDeletion({
            startBeat: 1,
            endBeat: 5,
            trackIds: ['target'],
        });

        expect(result.status).toBe('rejected');
        expect(trackStore.value).toBe(originalState);
        expect(midiStore.value).toBe(originalMidi);
    });

    it('rejects a non-encodable selected-range snapshot without publication or identity allocation', () => {
        const drop = createClip({
            id: 'drop',
            trackId: 'target',
            startBeat: 2,
            endBeat: 4,
        });
        const track = createTrack('target', [drop]);
        Object.defineProperty(track, Symbol('unsupported'), {
            enumerable: true,
            value: true,
        });
        const originalState = setArrangement([track]);
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        const result = executeSelectedTimeRangeDeletion({
            startBeat: 1,
            endBeat: 5,
            trackIds: ['target'],
        });

        expect(result).toEqual({ status: 'rejected', hasChanges: false, replayPlan: null, inversePlan: null });
        expect(trackStore.value).toBe(originalState);
        expect(randomUuid).not.toHaveBeenCalled();
    });

    it('rejects a changed MIDI owner without an inverse plan and an unchanged owner with one', () => {
        const drop = createClip({
            id: 'drop',
            trackId: 'target',
            startBeat: 2,
            endBeat: 4,
            type: 'midi',
        });
        const operation = {
            startBeat: 1,
            endBeat: 5,
            trackIds: ['target'],
        };
        let originalState = setArrangement([createTrack('target', [drop], 'midi')]);
        const changedApply = vi.fn(() => true);
        installMidiPreparation(() => ({
            status: 'ready',
            hasChanges: true,
            replayPlan: { version: 1, notes: [] },
            inversePlan: null,
            apply: changedApply,
            revert: () => true,
        }));

        expect(executeSelectedTimeRangeDeletion(operation)).toEqual({
            status: 'rejected',
            hasChanges: false,
            replayPlan: null,
            inversePlan: null,
        });
        expect(trackStore.value).toBe(originalState);
        expect(changedApply).not.toHaveBeenCalled();

        vi.clearAllMocks();
        originalState = setArrangement([createTrack('target', [drop], 'midi')]);
        const unchangedApply = vi.fn(() => false);
        installMidiPreparation(() => ({
            status: 'ready',
            hasChanges: false,
            replayPlan: { version: 1, notes: [] },
            inversePlan: TEST_OWNER_INVERSE_PLAN,
            apply: unchangedApply,
            revert: () => false,
        }));

        expect(executeSelectedTimeRangeDeletion(operation)).toEqual({
            status: 'rejected',
            hasChanges: false,
            replayPlan: null,
            inversePlan: null,
        });
        expect(trackStore.value).toBe(originalState);
        expect(unchangedApply).not.toHaveBeenCalled();
    });

    it('rejects generated clip IDs that collide with existing Arrangement identities', () => {
        const span = createClip({ id: 'span', trackId: 'target', startBeat: 0, endBeat: 10 });
        const collision = createClip({
            id: 'clip-dtr-12345678',
            trackId: 'other',
            startBeat: 20,
            endBeat: 22,
        });
        const originalState = setArrangement([createTrack('target', [span]), createTrack('other', [collision])]);

        const result = executeSelectedTimeRangeDeletion({
            startBeat: 3,
            endBeat: 7,
            trackIds: ['target'],
        });

        expect(result.status).toBe('rejected');
        expect(trackStore.value).toBe(originalState);
    });

    it('uses canonical store order for split identities when selected track IDs are reversed', () => {
        const firstSpan = createClip({
            id: 'first-span',
            trackId: 'first',
            startBeat: 0,
            endBeat: 10,
        });
        const secondSpan = createClip({
            id: 'second-span',
            trackId: 'second',
            startBeat: 0,
            endBeat: 10,
        });
        setArrangement([createTrack('first', [firstSpan]), createTrack('second', [secondSpan])]);
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-1234-4123-8123-123456789abc')
            .mockReturnValueOnce('22222222-1234-4123-8123-123456789abc');

        const result = requireApplied(
            executeSelectedTimeRangeDeletion({
                startBeat: 3,
                endBeat: 7,
                trackIds: ['second', 'first'],
            })
        );

        expect(result.replayPlan.operation.trackIds).toEqual(['second', 'first']);
        expect(result.replayPlan.clips).toEqual([
            {
                role: 'selected-delete-right',
                sourceTrackId: 'first',
                sourceClipId: 'first-span',
                targetClipId: 'clip-dtr-11111111',
            },
            {
                role: 'selected-delete-right',
                sourceTrackId: 'second',
                sourceClipId: 'second-span',
                targetClipId: 'clip-dtr-22222222',
            },
        ]);
        expect(trackStore.value?.tracks[0]?.clips[1]?.id).toBe('clip-dtr-11111111');
        expect(trackStore.value?.tracks[1]?.clips[1]?.id).toBe('clip-dtr-22222222');
    });

    it('returns a detached JSON inverse plan with the selected-range owner matrix and unchanged callback undo', () => {
        const span = createClip({
            id: 'span',
            trackId: 'target',
            startBeat: 0,
            endBeat: 10,
            type: 'midi',
        });
        const track = createTrack('target', [span], 'midi');
        track.pan = -0;
        const originalState = setArrangement([track]);
        installMidiPreparation(() => ({
            status: 'ready',
            hasChanges: true,
            replayPlan: { version: 1, notes: [] },
            inversePlan: TEST_OWNER_INVERSE_PLAN,
            apply: () => true,
            revert: () => true,
        }));

        const result = requireApplied(
            executeSelectedTimeRangeDeletion({
                startBeat: 3,
                endBeat: 7,
                trackIds: ['target'],
            })
        );

        expect(JSON.parse(JSON.stringify(result.inversePlan))).toEqual(result.inversePlan);
        const inversePlan = requireRecord(result.inversePlan);
        expect(inversePlan).toMatchObject({
            version: 1,
            scope: 'selected-range',
            automation: null,
            midi: TEST_OWNER_INVERSE_PLAN,
            timelineMap: null,
        });
        const local = requireRecord(inversePlan.local);
        const expected = requireRecord(local.expected);
        const replacement = requireRecord(local.replacement);
        expect(expected.markerState).toBeNull();
        expect(replacement.markerState).toBeNull();
        const expectedTrackState = timeOperationStateCodec.decodeTrackState(expected.trackState);
        const replacementTrackState = timeOperationStateCodec.decodeTrackState(replacement.trackState);
        expect(expectedTrackState).toEqual(trackStore.value);
        expect(expectedTrackState).not.toBe(trackStore.value);
        expect(replacementTrackState).toEqual(originalState);
        expect(replacementTrackState).not.toBe(originalState);
        expect(Object.is(expectedTrackState?.tracks[0]?.pan, -0)).toBe(true);
        expect(Object.is(replacementTrackState?.tracks[0]?.pan, -0)).toBe(true);
        expect(result.undo()).toBe(true);
        expect(trackStore.value).toBe(originalState);
    });

    it.each(CANONICAL_TRACK_KINDS)(
        'applies identical selected-range geometry and preserves state for %s tracks',
        (kind) => {
            const drop = createClip({
                id: 'drop',
                trackId: 'target',
                startBeat: 4,
                endBeat: 5,
            });
            const span = createClip({
                id: 'span',
                trackId: 'target',
                startBeat: 0,
                endBeat: 10,
            });
            const untouched = createClip({
                id: 'untouched',
                trackId: 'target',
                startBeat: 12,
                endBeat: 14,
            });
            const otherClip = createClip({
                id: 'other-clip',
                trackId: 'other',
                startBeat: 2,
                endBeat: 4,
            });
            const target = createTrack('target', [drop, span, untouched], kind);
            const other = createTrack('other', [otherClip]);
            const originalState = setArrangement([target, other]);
            const originalMidiState = midiStore.value;

            requireApplied(
                executeSelectedTimeRangeDeletion({
                    startBeat: 3,
                    endBeat: 7,
                    trackIds: ['target'],
                })
            );

            expect(trackStore.value?.tracks[0]).toEqual({
                ...target,
                clips: [
                    { ...span, endBeat: 3, name: 'Test Clip (L)' },
                    {
                        ...span,
                        id: 'clip-dtr-12345678',
                        startBeat: 7,
                        name: 'Test Clip (R)',
                        audioOffsetBeats: 7,
                        midiOffsetBeats: 0,
                    },
                    untouched,
                ],
            });
            expect(trackStore.value?.tracks[1]).toBe(other);
            expect(trackStore.value?.selectedTrackId).toBe(originalState.selectedTrackId);
            expect(trackStore.value?.ghostClips).toBe(originalState.ghostClips);
            expect(midiStore.value).toBe(originalMidiState);
        }
    );

    it('reuses the exact supplied replay plan and every generated clip and note identity', () => {
        const span = createClip({
            id: 'span',
            trackId: 'target',
            startBeat: 0,
            endBeat: 10,
            type: 'midi',
        });
        const originalState = setArrangement([createTrack('target', [span])]);
        const originalMidi = {
            notesByClipId: {
                span: [
                    { id: 'left', pitch: 60, startBeat: 1, duration: 1, velocity: 90 },
                    { id: 'right', pitch: 64, startBeat: 8, duration: 1, velocity: 90 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        midiStore.set(originalMidi);
        const originalMidiState = midiStore.value;

        const first = requireApplied(
            executeSelectedTimeRangeDeletion({
                startBeat: 3,
                endBeat: 7,
                trackIds: ['target'],
            })
        );
        const firstArrangement = trackStore.value;
        const firstMidi = midiStore.value;
        expect(first.undo()).toBe(true);
        expect(trackStore.value).toBe(originalState);
        expect(midiStore.value).toBe(originalMidiState);
        const randomUuid = vi.spyOn(crypto, 'randomUUID');
        randomUuid.mockClear();

        const replay = requireApplied(
            executeSelectedTimeRangeDeletion({
                startBeat: 3,
                endBeat: 7,
                trackIds: ['target'],
                replayPlan: first.replayPlan,
            })
        );

        expect(replay.replayPlan).toBe(first.replayPlan);
        expect(randomUuid).not.toHaveBeenCalled();
        expect(trackStore.value).toEqual(firstArrangement);
        expect(midiStore.value).toEqual(firstMidi);
        expect(trackStore.value?.tracks[0]?.clips[1]?.id).toBe('clip-dtr-12345678');
        expect(midiStore.value?.notesByClipId['clip-dtr-12345678']?.map((note) => note.id)).toEqual(
            firstMidi?.notesByClipId['clip-dtr-12345678']?.map((note) => note.id)
        );
    });

    it('rejects missing, reordered, and operation-mismatched replay identities without allocation', () => {
        const firstSpan = createClip({ id: 'first', trackId: 'target', startBeat: 0, endBeat: 10 });
        const secondSpan = createClip({ id: 'second', trackId: 'target', startBeat: 0, endBeat: 12 });
        const originalState = setArrangement([createTrack('target', [firstSpan, secondSpan])]);
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-1234-4123-8123-123456789abc')
            .mockReturnValueOnce('22222222-1234-4123-8123-123456789abc');
        const first = requireApplied(
            executeSelectedTimeRangeDeletion({
                startBeat: 3,
                endBeat: 7,
                trackIds: ['target'],
            })
        );
        expect(first.undo()).toBe(true);
        expect(trackStore.value).toBe(originalState);
        const randomUuid = vi.spyOn(crypto, 'randomUUID');
        randomUuid.mockClear();

        const reorderedPlan = {
            ...first.replayPlan,
            clips: [...first.replayPlan.clips].reverse(),
        };
        const mismatchedPlan = {
            ...first.replayPlan,
            operation: {
                ...first.replayPlan.operation,
                endBeat: 8,
            },
        };
        const missingPlan = {
            ...first.replayPlan,
            clips: first.replayPlan.clips.slice(0, 1),
        };

        expect(
            executeSelectedTimeRangeDeletion({
                startBeat: 3,
                endBeat: 7,
                trackIds: ['target'],
                replayPlan: reorderedPlan,
            }).status
        ).toBe('rejected');
        expect(
            executeSelectedTimeRangeDeletion({
                startBeat: 3,
                endBeat: 7,
                trackIds: ['target'],
                replayPlan: mismatchedPlan,
            }).status
        ).toBe('rejected');
        expect(
            executeSelectedTimeRangeDeletion({
                startBeat: 3,
                endBeat: 7,
                trackIds: ['target'],
                replayPlan: missingPlan,
            }).status
        ).toBe('rejected');
        expect(randomUuid).not.toHaveBeenCalled();
        expect(trackStore.value).toBe(originalState);
    });

    it('rolls MIDI back when Arrangement publication returns false', () => {
        const clip = createClip({ id: 'drop', trackId: 'target', startBeat: 2, endBeat: 4 });
        const originalState = setArrangement([createTrack('target', [clip])]);
        const order: string[] = [];
        const midiApply = vi.fn(() => {
            order.push('midi-apply');
            return true;
        });
        const midiRevert = vi.fn(() => {
            order.push('midi-revert');
            return true;
        });
        installMidiPreparation(() => ({
            status: 'ready',
            hasChanges: true,
            replayPlan: { version: 1, notes: [] },
            apply: midiApply,
            revert: midiRevert,
        }));
        vi.spyOn(trackStore, 'set').mockImplementationOnce(() => undefined);

        const result = executeSelectedTimeRangeDeletion({
            startBeat: 1,
            endBeat: 5,
            trackIds: ['target'],
        });

        expect(result.status).toBe('rejected');
        expect(order).toEqual(['midi-apply', 'midi-revert']);
        expect(trackStore.value).toBe(originalState);
    });

    it('rejects an owner publication that returns false before Arrangement changes', () => {
        const clip = createClip({ id: 'drop', trackId: 'target', startBeat: 2, endBeat: 4 });
        const originalState = setArrangement([createTrack('target', [clip])]);
        const midiRevert = vi.fn(() => false);
        installMidiPreparation(() => ({
            status: 'ready',
            hasChanges: true,
            replayPlan: { version: 1, notes: [] },
            apply: () => false,
            revert: midiRevert,
        }));

        const result = executeSelectedTimeRangeDeletion({
            startBeat: 1,
            endBeat: 5,
            trackIds: ['target'],
        });

        expect(result.status).toBe('rejected');
        expect(trackStore.value).toBe(originalState);
        expect(midiRevert).not.toHaveBeenCalled();
    });

    it('rethrows an owner publication error before Arrangement changes', () => {
        const clip = createClip({ id: 'drop', trackId: 'target', startBeat: 2, endBeat: 4 });
        const originalState = setArrangement([createTrack('target', [clip])]);
        const ownerFailure = new Error('MIDI publication failed');
        installMidiPreparation(() => ({
            status: 'ready',
            hasChanges: true,
            replayPlan: { version: 1, notes: [] },
            apply: () => {
                throw ownerFailure;
            },
            revert: () => false,
        }));

        expect(() =>
            executeSelectedTimeRangeDeletion({
                startBeat: 1,
                endBeat: 5,
                trackIds: ['target'],
            })
        ).toThrow(ownerFailure);
        expect(trackStore.value).toBe(originalState);
    });

    it('rejects a locally stale publication and compensates the applied MIDI owner', () => {
        const clip = createClip({ id: 'drop', trackId: 'target', startBeat: 2, endBeat: 4 });
        const originalState = setArrangement([createTrack('target', [clip])]);
        const midiRevert = vi.fn(() => {
            trackStore.set(originalState);
            return true;
        });
        installMidiPreparation(() => ({
            status: 'ready',
            hasChanges: true,
            replayPlan: { version: 1, notes: [] },
            apply: () => {
                trackStore.set({ ...originalState });
                return true;
            },
            revert: midiRevert,
        }));

        const result = executeSelectedTimeRangeDeletion({
            startBeat: 1,
            endBeat: 5,
            trackIds: ['target'],
        });

        expect(result.status).toBe('rejected');
        expect(midiRevert).toHaveBeenCalledOnce();
        expect(trackStore.value).toBe(originalState);
    });

    it('surfaces an unexpected Arrangement publication reference as unrecovered partial state', () => {
        const clip = createClip({ id: 'drop', trackId: 'target', startBeat: 2, endBeat: 4 });
        const originalState = setArrangement([createTrack('target', [clip])]);
        const unexpectedState = { ...originalState };
        const originalSet = trackStore.set.bind(trackStore);
        const midiRevert = vi.fn(() => true);
        installMidiPreparation(() => ({
            status: 'ready',
            hasChanges: true,
            replayPlan: { version: 1, notes: [] },
            apply: () => true,
            revert: midiRevert,
        }));
        vi.spyOn(trackStore, 'set').mockImplementationOnce(() => {
            originalSet(unexpectedState);
        });

        expect(() =>
            executeSelectedTimeRangeDeletion({
                startBeat: 1,
                endBeat: 5,
                trackIds: ['target'],
            })
        ).toThrow(
            expect.objectContaining({
                name: 'UnrecoveredSelectedTimeRangeDeletionError',
            })
        );
        expect(midiRevert).toHaveBeenCalledOnce();
        expect(trackStore.value).toBe(unexpectedState);
    });

    it('continues compensation and exposes original plus compensation failures', () => {
        const clip = createClip({ id: 'drop', trackId: 'target', startBeat: 2, endBeat: 4 });
        const originalState = setArrangement([createTrack('target', [clip])]);
        const originalFailure = new Error('Arrangement did not retain publication');
        const compensationFailure = new Error('MIDI compensation failed');
        installMidiPreparation(() => ({
            status: 'ready',
            hasChanges: true,
            replayPlan: { version: 1, notes: [] },
            apply: () => true,
            revert: () => {
                throw compensationFailure;
            },
        }));
        vi.spyOn(trackStore, 'set').mockImplementationOnce(() => {
            throw originalFailure;
        });

        let thrown: unknown;
        try {
            executeSelectedTimeRangeDeletion({
                startBeat: 1,
                endBeat: 5,
                trackIds: ['target'],
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown).toMatchObject({
            name: 'UnrecoveredSelectedTimeRangeDeletionError',
        });
        if (!thrown || typeof thrown !== 'object') {
            throw new Error('Expected unrecovered error object');
        }
        expect(Reflect.get(thrown, 'originalFailure')).toBe(originalFailure);
        expect(Reflect.get(thrown, 'compensationFailures')).toContain(compensationFailure);
        expect(trackStore.value).toBe(originalState);
    });

    it('compensates a published local write that throws and then compensates MIDI', () => {
        const clip = createClip({ id: 'drop', trackId: 'target', startBeat: 2, endBeat: 4 });
        const originalState = setArrangement([createTrack('target', [clip])]);
        const originalSet = trackStore.set.bind(trackStore);
        const publicationFailure = new Error('local publication threw');
        const midiRevert = vi.fn(() => true);
        installMidiPreparation(() => ({
            status: 'ready',
            hasChanges: true,
            replayPlan: { version: 1, notes: [] },
            apply: () => true,
            revert: midiRevert,
        }));
        vi.spyOn(trackStore, 'set')
            .mockImplementationOnce((nextState) => {
                originalSet(nextState);
                throw publicationFailure;
            })
            .mockImplementation(originalSet);

        expect(() =>
            executeSelectedTimeRangeDeletion({
                startBeat: 1,
                endBeat: 5,
                trackIds: ['target'],
            })
        ).toThrow(publicationFailure);
        expect(trackStore.value).toBe(originalState);
        expect(midiRevert).toHaveBeenCalledOnce();
    });

    it('restores Arrangement back to the exact applied reference when MIDI undo fails', () => {
        const clip = createClip({ id: 'drop', trackId: 'target', startBeat: 2, endBeat: 4 });
        const originalState = setArrangement([createTrack('target', [clip])]);
        installMidiPreparation(() => ({
            status: 'ready',
            hasChanges: true,
            replayPlan: { version: 1, notes: [] },
            apply: () => true,
            revert: () => false,
        }));
        const result = requireApplied(
            executeSelectedTimeRangeDeletion({
                startBeat: 1,
                endBeat: 5,
                trackIds: ['target'],
            })
        );
        const appliedState = trackStore.value;

        expect(() => result.undo()).toThrow('MIDI undo returned false');
        expect(trackStore.value).toBe(appliedState);
        expect(trackStore.value).not.toBe(originalState);
    });

    it('batches subscriber visibility across Arrangement and MIDI publication', () => {
        const span = createClip({
            id: 'span',
            trackId: 'target',
            startBeat: 0,
            endBeat: 10,
            type: 'midi',
        });
        setArrangement([createTrack('target', [span])]);
        midiStore.set({
            notesByClipId: {
                span: [{ id: 'right', pitch: 64, startBeat: 8, duration: 1, velocity: 90 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        const observations: Array<{ arrangementApplied: boolean; midiApplied: boolean }> = [];
        function observe(): void {
            observations.push({
                arrangementApplied: trackStore.value?.tracks[0]?.clips.length === 2,
                midiApplied: Object.hasOwn(midiStore.value?.notesByClipId ?? {}, 'clip-dtr-12345678'),
            });
        }
        const unsubscribeArrangement = trackStore.subscribe(observe);
        const unsubscribeMidi = midiStore.subscribe(observe);

        const result = executeSelectedTimeRangeDeletion({
            startBeat: 3,
            endBeat: 7,
            trackIds: ['target'],
        });

        unsubscribeArrangement();
        unsubscribeMidi();
        requireApplied(result);
        expect(observations.length).toBeGreaterThan(0);
        expect(observations.every((observation) => observation.arrangementApplied && observation.midiApplied)).toBe(
            true
        );
    });

    it('batches subscriber visibility across successful Arrangement and MIDI undo', () => {
        const span = createClip({
            id: 'span',
            trackId: 'target',
            startBeat: 0,
            endBeat: 10,
            type: 'midi',
        });
        const originalArrangement = setArrangement([createTrack('target', [span])]);
        midiStore.set({
            notesByClipId: {
                span: [{ id: 'right', pitch: 64, startBeat: 8, duration: 1, velocity: 90 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        const originalMidi = midiStore.value;
        const result = requireApplied(
            executeSelectedTimeRangeDeletion({
                startBeat: 3,
                endBeat: 7,
                trackIds: ['target'],
            })
        );
        const observations: Array<{ arrangementRestored: boolean; midiRestored: boolean }> = [];
        function observe(): void {
            observations.push({
                arrangementRestored: trackStore.value === originalArrangement,
                midiRestored: midiStore.value === originalMidi,
            });
        }
        const unsubscribeArrangement = trackStore.subscribe(observe);
        const unsubscribeMidi = midiStore.subscribe(observe);

        expect(result.undo()).toBe(true);

        unsubscribeArrangement();
        unsubscribeMidi();
        expect(trackStore.value).toBe(originalArrangement);
        expect(midiStore.value).toBe(originalMidi);
        expect(observations.length).toBeGreaterThan(0);
        expect(observations.every((observation) => observation.arrangementRestored && observation.midiRestored)).toBe(
            true
        );
    });

    // #4520 — the deletion must retire the take-lane state of the clips it
    // fully removes, or an orphan comp region keeps advancing the comp cursor
    // over the freed span.
    it('retires the takes and comp regions of clips the range fully removes', () => {
        const comped = createClip({ id: 'comped', trackId: 'target', startBeat: 2, endBeat: 6 });
        const keeper = createClip({ id: 'keeper', trackId: 'target', startBeat: 8, endBeat: 12 });
        setArrangement([createTrack('target', [comped, keeper])]);
        // The spec pins crypto.randomUUID to a constant, so takes built here
        // carry explicit ids — retirement matches takes by id.
        const compedTake = { ...createTake('comped', 'Comped take', 2, 6), id: 'take-comped' };
        const keeperTake = { ...createTake('keeper', 'Keeper take', 8, 12), id: 'take-keeper' };
        const lane: TakeLane = {
            ...createTakeLane('target'),
            takes: [compedTake, keeperTake],
            activeCompRegions: [{ startBeat: 2, endBeat: 6, takeId: compedTake.id }],
        };
        takeLaneStore.set({ lanes: [lane] });

        const result = requireApplied(
            executeSelectedTimeRangeDeletion({
                startBeat: 2,
                endBeat: 6,
                trackIds: ['target'],
            })
        );

        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['keeper']);
        // The lane survives on its other take; the removed clip's take and the
        // region naming it are gone.
        const lanes = takeLaneStore.value?.lanes ?? [];
        expect(lanes).toHaveLength(1);
        expect(lanes[0]?.id).toBe(lane.id);
        expect(lanes[0]?.takes.map((take) => take.id)).toEqual([keeperTake.id]);
        expect(lanes[0]?.activeCompRegions).toEqual([]);
        // The capture rides the inverse plan, like every other retired state.
        expect(JSON.parse(JSON.stringify(result.inversePlan))).toEqual(result.inversePlan);
        expect(result.inversePlan).toMatchObject({
            takeLanes: {
                version: 1,
                appliedEffect: 'restore',
                removedClipIds: ['comped'],
                retiredLanes: [{ laneIndex: 0, retiredTakeIds: [compedTake.id] }],
            },
        });
    });

    it('lets a clip landing on the freed span resolve instead of going silent behind an orphan region', () => {
        const comped = createClip({ id: 'comped', trackId: 'target', startBeat: 2, endBeat: 6 });
        setArrangement([createTrack('target', [comped])]);
        const compedTake = createTake('comped', 'Comped take', 2, 6);
        takeLaneStore.set({
            lanes: [
                {
                    ...createTakeLane('target'),
                    takes: [compedTake],
                    activeCompRegions: [{ startBeat: 2, endBeat: 6, takeId: compedTake.id }],
                },
            ],
        });

        requireApplied(executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['target'] }));

        // A clip drawn over the freed span afterwards: before the fix the orphan
        // region [2,6] still advanced the comp cursor and swallowed it whole.
        const drawn = createClip({ id: 'drawn', trackId: 'target', startBeat: 2, endBeat: 6 });
        const resolved = resolveClipsWithComping('target', [drawn]);
        expect(resolved.map((fragment) => [fragment.startBeat, fragment.endBeat])).toEqual([[2, 6]]);
    });

    it('restores the retired lanes on undo and retires them again on replay redo', () => {
        const comped = createClip({ id: 'comped', trackId: 'target', startBeat: 2, endBeat: 6 });
        const keeper = createClip({ id: 'keeper', trackId: 'target', startBeat: 8, endBeat: 12 });
        const originalState = setArrangement([createTrack('target', [comped, keeper])]);
        // The spec pins crypto.randomUUID to a constant, so takes built here
        // carry explicit ids — retirement matches takes by id.
        const compedTake = { ...createTake('comped', 'Comped take', 2, 6), id: 'take-comped' };
        const keeperTake = { ...createTake('keeper', 'Keeper take', 8, 12), id: 'take-keeper' };
        const lane: TakeLane = {
            ...createTakeLane('target'),
            takes: [compedTake, keeperTake],
            activeCompRegions: [{ startBeat: 2, endBeat: 6, takeId: compedTake.id }],
        };
        takeLaneStore.set({ lanes: [lane] });

        const first = requireApplied(
            executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['target'] })
        );
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.id)).toEqual([keeperTake.id]);

        expect(first.undo()).toBe(true);
        expect(trackStore.value).toBe(originalState);
        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(restoredLane?.id).toBe(lane.id);
        expect(restoredLane?.takes.map((take) => take.id)).toEqual([compedTake.id, keeperTake.id]);
        expect(restoredLane?.activeCompRegions).toEqual([{ startBeat: 2, endBeat: 6, takeId: compedTake.id }]);

        // Redo re-runs the deletion with the captured replay plan; its own undo
        // closure carries the lanes that replay retired.
        const replay = requireApplied(
            executeSelectedTimeRangeDeletion({
                startBeat: 2,
                endBeat: 6,
                trackIds: ['target'],
                replayPlan: first.replayPlan,
            })
        );
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['keeper']);
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.id)).toEqual([keeperTake.id]);
        expect(takeLaneStore.value?.lanes[0]?.activeCompRegions).toEqual([]);

        expect(replay.undo()).toBe(true);
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.id)).toEqual([compedTake.id, keeperTake.id]);
    });

    // #4841 — a clip the range splits keeps its material on both halves, so
    // its takes and comp regions follow the fragments instead of staying keyed
    // to the pre-split geometry.
    it('splits the take and comp region of a clip spanning the deleted range', () => {
        const span = createClip({ id: 'span', trackId: 'target', startBeat: 0, endBeat: 10 });
        setArrangement([createTrack('target', [span])]);
        // The spec pins crypto.randomUUID to a constant, so the fragment clip
        // id and the explicitly pinned take id are both deterministic.
        const spanTake = { ...createTake('span', 'Span take', 0, 10), id: 'take-span' };
        const lane: TakeLane = {
            ...createTakeLane('target'),
            takes: [spanTake],
            activeCompRegions: [{ startBeat: 0, endBeat: 10, takeId: spanTake.id }],
        };
        takeLaneStore.set({ lanes: [lane] });

        const result = requireApplied(
            executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['target'] })
        );

        // The excise leaves a gap: the left half keeps the clip id at [0,2],
        // the right fragment stays at [6,10] under the replayed identity.
        const clips = trackStore.value?.tracks[0]?.clips ?? [];
        expect(clips.map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([
            ['span', 0, 2],
            ['clip-dtr-12345678', 6, 10],
        ]);
        // One take per fragment: the left keeps the take's id — the split
        // convention — and the right mints a deterministic one, so a replayed
        // redo re-mints the same id.
        const rightTakeId = 'take-span:time-delete-right:2:6';
        const lanes = takeLaneStore.value?.lanes ?? [];
        expect(lanes[0]?.takes).toEqual([
            { ...spanTake, startBeat: 0, endBeat: 2 },
            { ...spanTake, id: rightTakeId, clipId: 'clip-dtr-12345678', startBeat: 6, endBeat: 10 },
        ]);
        expect(lanes[0]?.activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 2, takeId: spanTake.id },
            { startBeat: 6, endBeat: 10, takeId: rightTakeId },
        ]);
        // Before the fix the region kept advancing the comp cursor over [6,10]
        // while its take still named the pre-split geometry: the right
        // fragment resolved to nothing.
        expect(resolveClipsWithComping('target', [...clips]).map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
            [0, 2],
            [6, 10],
        ]);
        // The capture rides the inverse plan as plain JSON, like every other slot.
        expect(JSON.parse(JSON.stringify(result.inversePlan))).toEqual(result.inversePlan);
        expect(result.inversePlan).toMatchObject({
            takeLanes: {
                version: 1,
                appliedEffect: 'restore',
                removedClipIds: [],
                retiredLanes: [],
                reKeyedLanes: [
                    {
                        laneIndex: 0,
                        laneId: lane.id,
                        trackId: 'target',
                        takesBefore: [spanTake],
                        regionsBefore: [{ startBeat: 0, endBeat: 10, takeId: spanTake.id }],
                        regionsAfter: [
                            { startBeat: 0, endBeat: 2, takeId: spanTake.id },
                            { startBeat: 6, endBeat: 10, takeId: rightTakeId },
                        ],
                    },
                ],
            },
        });
    });

    it('restores the split takes on undo and re-keys them identically on replay redo', () => {
        const span = createClip({ id: 'span', trackId: 'target', startBeat: 0, endBeat: 10 });
        const originalState = setArrangement([createTrack('target', [span])]);
        const spanTake = { ...createTake('span', 'Span take', 0, 10), id: 'take-span' };
        takeLaneStore.set({
            lanes: [
                {
                    ...createTakeLane('target'),
                    takes: [spanTake],
                    activeCompRegions: [{ startBeat: 0, endBeat: 10, takeId: spanTake.id }],
                },
            ],
        });

        const first = requireApplied(
            executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['target'] })
        );
        const rightTakeId = 'take-span:time-delete-right:2:6';
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.id)).toEqual([spanTake.id, rightTakeId]);

        expect(first.undo()).toBe(true);
        expect(trackStore.value).toBe(originalState);
        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(restoredLane?.takes).toEqual([spanTake]);
        expect(restoredLane?.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 10, takeId: spanTake.id }]);

        // Redo re-runs the deletion with the captured replay plan; the re-key
        // capture derives the same fragment take ids, because they mint from
        // the take id and the deleted span, not from fresh randomness.
        const replay = requireApplied(
            executeSelectedTimeRangeDeletion({
                startBeat: 2,
                endBeat: 6,
                trackIds: ['target'],
                replayPlan: first.replayPlan,
            })
        );
        const clips = trackStore.value?.tracks[0]?.clips ?? [];
        expect(clips.map((clip) => clip.id)).toEqual(['span', 'clip-dtr-12345678']);
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.id)).toEqual([spanTake.id, rightTakeId]);
        expect(takeLaneStore.value?.lanes[0]?.activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 2, takeId: spanTake.id },
            { startBeat: 6, endBeat: 10, takeId: rightTakeId },
        ]);
        expect(resolveClipsWithComping('target', [...clips]).map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
            [0, 2],
            [6, 10],
        ]);

        expect(replay.undo()).toBe(true);
        expect(takeLaneStore.value?.lanes[0]?.takes).toEqual([spanTake]);
    });

    it('does not rewrite the take-lane store when no take names a removed clip', () => {
        const drop = createClip({ id: 'drop', trackId: 'target', startBeat: 2, endBeat: 6 });
        setArrangement([createTrack('target', [drop])]);
        takeLaneStore.set({
            lanes: [{ ...createTakeLane('target'), takes: [createTake('unrelated', 'Unrelated', 0, 4)] }],
        });
        const laneStateBefore = takeLaneStore.value;

        const result = requireApplied(
            executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['target'] })
        );

        expect(takeLaneStore.value).toBe(laneStateBefore);
        expect(result.inversePlan).toMatchObject({ takeLanes: null });
    });

    it('keeps the take and region of a clip parked right of the excised range', () => {
        // The keeper sits wholly right of the range and does not move — the
        // excise leaves the gap. Its take and region ride the lane untouched:
        // the clamp that guards stale overhangs must not mistake a region
        // right of the range for deleted material.
        const left = createClip({ id: 'left', trackId: 'target', startBeat: 0, endBeat: 4 });
        const keeper = createClip({ id: 'keeper', trackId: 'target', startBeat: 8, endBeat: 12 });
        setArrangement([createTrack('target', [left, keeper])]);
        const keeperTake = { ...createTake('keeper', 'Keeper take', 8, 12), id: 'take-keeper' };
        const lane: TakeLane = {
            ...createTakeLane('target'),
            takes: [keeperTake],
            activeCompRegions: [{ startBeat: 8, endBeat: 12, takeId: keeperTake.id }],
        };
        takeLaneStore.set({ lanes: [lane] });

        requireApplied(executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['target'] }));

        expect(trackStore.value?.tracks[0]?.clips.map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([
            ['left', 0, 2],
            ['keeper', 8, 12],
        ]);
        expect(takeLaneStore.value?.lanes[0]?.takes).toEqual([keeperTake]);
        expect(takeLaneStore.value?.lanes[0]?.activeCompRegions).toEqual([
            { startBeat: 8, endBeat: 12, takeId: keeperTake.id },
        ]);
    });

    it('keeps a stale region’s right-of-range tail verbatim when the excise moves nothing there', () => {
        // The stale region overhangs its take across the whole range. The
        // excise consumes the in-range portion, but the tail right of the
        // range names material nothing moved: it survives verbatim instead of
        // being clamped away with the deleted beats.
        const host = createClip({ id: 'host', trackId: 'target', startBeat: 0, endBeat: 2 });
        const cut = createClip({ id: 'cut', trackId: 'target', startBeat: 4, endBeat: 10 });
        setArrangement([createTrack('target', [host, cut])]);
        const hostTake = { ...createTake('host', 'Host take', 0, 2), id: 'take-host' };
        const lane: TakeLane = {
            ...createTakeLane('target'),
            takes: [hostTake],
            activeCompRegions: [{ startBeat: 0, endBeat: 12, takeId: hostTake.id }],
        };
        takeLaneStore.set({ lanes: [lane] });

        requireApplied(executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['target'] }));

        expect(trackStore.value?.tracks[0]?.clips.map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([
            ['host', 0, 2],
            // The cut clip's only survivor is its right half, so it keeps the
            // clip id — no left half exists to claim it.
            ['cut', 6, 10],
        ]);
        expect(takeLaneStore.value?.lanes[0]?.takes).toEqual([hostTake]);
        expect(takeLaneStore.value?.lanes[0]?.activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 2, takeId: hostTake.id },
            { startBeat: 6, endBeat: 12, takeId: hostTake.id },
        ]);
    });

    it('re-keys a right-fragment take onto the fragment clip, keeping its id and geometry', () => {
        // The take covers exactly the material the right fragment carries: it
        // belongs to the fragment clip after the split, and only its clipId
        // moves. A modification check blind to clipId would leave it keyed to
        // the pre-split clip.
        const span = createClip({ id: 'span', trackId: 'target', startBeat: 0, endBeat: 10 });
        setArrangement([createTrack('target', [span])]);
        const tailTake = { ...createTake('span', 'Tail take', 6, 10), id: 'take-tail' };
        const lane: TakeLane = {
            ...createTakeLane('target'),
            takes: [tailTake],
            activeCompRegions: [{ startBeat: 6, endBeat: 10, takeId: tailTake.id }],
        };
        takeLaneStore.set({ lanes: [lane] });

        requireApplied(executeSelectedTimeRangeDeletion({ startBeat: 2, endBeat: 6, trackIds: ['target'] }));

        expect(takeLaneStore.value?.lanes[0]?.takes).toEqual([{ ...tailTake, clipId: 'clip-dtr-12345678' }]);
        expect(takeLaneStore.value?.lanes[0]?.activeCompRegions).toEqual([
            { startBeat: 6, endBeat: 10, takeId: tailTake.id },
        ]);
    });
});

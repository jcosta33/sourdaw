import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores';
import { prepareMidiGlobalTimeTransaction } from '#/modules/MIDI/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import {
    setTimeOperationDependencies,
    type TimeOperationDependencies,
} from '../../timeOperations/timeOperationDependencies';
import { executeSelectedTimeRangeDeletion } from '../executeSelectedTimeRangeDeletion';

const EMPTY_MIDI_STATE = {
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
};

function noChangePreparation() {
    return {
        status: 'ready' as const,
        hasChanges: false,
        replayPlan: { version: 1 as const, notes: [] },
        apply: () => false,
        revert: () => false,
    };
}

function installMidiPreparation(prepareMidi: TimeOperationDependencies['prepareMidiGlobalTimeTransaction']): void {
    setTimeOperationDependencies({
        prepareAutomationTimeOperation: noChangePreparation,
        prepareMidiGlobalTimeTransaction: prepareMidi,
        prepareTimelineMapTimeOperation: noChangePreparation,
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

function createTrack(id: string, clips: ReturnType<typeof createClip>[]) {
    return TrackDummy.create({ id, clips });
}

function createDormantTrack(id: string, clips: ReturnType<typeof createClip>[]) {
    const track = createTrack(id, clips);
    Reflect.set(track, 'kind', 'vca');
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

describe('executeSelectedTimeRangeDeletion', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        trackStore.set({
            tracks: [],
            selectedTrackId: null,
            ghostClips: [],
        });
        midiStore.set(EMPTY_MIDI_STATE);
        installRealMidiPreparation();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4123-8123-123456789abc');
    });

    afterEach(() => {
        setTimeOperationDependencies(null);
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
});

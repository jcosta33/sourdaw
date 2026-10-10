import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { LEGACY_MIDI_PROBABILITY_SEED, type MidiStoreState } from '#/modules/MIDI/stores';

import { takeLaneStore } from '../../../stores/takeLaneStore';
import { type rippleDeleteClips } from '../../../useCases/rippleDelete/rippleDeleteClips';
import { handleRemoveClip } from '../handleRemoveClip';

type RippleDeleteInput = Parameters<typeof rippleDeleteClips>[0];
type RippleDeleteResult = NonNullable<ReturnType<typeof rippleDeleteClips>>;
type TestClip = RippleDeleteResult['removedClips'][number];

type TestTrackState = {
    tracks: { id: string; clips: TestClip[] }[];
};

type CreateTestClipInput = {
    id: string;
    startBeat: number;
    endBeat: number;
};

function createTestClip({ id, startBeat, endBeat }: CreateTestClipInput): TestClip {
    return {
        id,
        trackId: 't1',
        name: `Clip ${id}`,
        startBeat,
        endBeat,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn<() => TestTrackState | null>(),
    removeClip: vi.fn<(clipId: string) => void>(),
    planRippleDelete: vi.fn<(input: RippleDeleteInput) => RippleDeleteResult | null>(),
    rippleDeleteClips: vi.fn<typeof rippleDeleteClips>(),
    getMidiStoreState: vi.fn<() => MidiStoreState | null>(),
    removeMidiClipData: vi.fn<(clipIds: readonly string[]) => void>(),
    readClipSatelliteEntry: vi.fn(),
    readClipScopedAutomationLanes: vi.fn(),
    ownsMutation: vi.fn(() => true),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/clip/removeClip', () => ({
    removeClip: mocks.removeClip,
}));

vi.mock('../../../useCases/rippleDelete/planRippleDelete', () => ({
    planRippleDelete: mocks.planRippleDelete,
}));

vi.mock('../../../useCases/rippleDelete/rippleDeleteClips', () => ({
    rippleDeleteClips: mocks.rippleDeleteClips,
}));

vi.mock('#/modules/Command/useCases', () => ({
    commitRedoInverseCapture: vi.fn(),
    pushUndoEntry: vi.fn(),
    getExecutableAppActionEffect: vi.fn(),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureDurableDocumentWitness: vi.fn(() => ''),
    captureProjectMutationAuthorization: vi.fn(() => mocks.ownsMutation),
    getCrdtDoc: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    decodeMidiClipDataSnapshots: vi.fn(() => null),
    getMidiStoreState: mocks.getMidiStoreState,
    removeMidiClipData: mocks.removeMidiClipData,
}));

vi.mock('../../../stores/clipSatelliteState', () => ({
    readClipSatelliteEntry: mocks.readClipSatelliteEntry,
}));

vi.mock('../../../useCases/clip/readClipScopedAutomationLanes', () => ({
    readClipScopedAutomationLanes: mocks.readClipScopedAutomationLanes,
}));

describe('handleRemoveClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.removeClip.mockReset();
        mocks.getTrackStoreState.mockReturnValue(null);
        mocks.planRippleDelete.mockReturnValue(null);
        mocks.rippleDeleteClips.mockReturnValue(null);
        mocks.getMidiStoreState.mockReturnValue(null);
        mocks.readClipSatelliteEntry.mockImplementation((clipId: string) => ({
            clipId,
            gainEnvelope: null,
            warpState: null,
        }));
        mocks.readClipScopedAutomationLanes.mockReturnValue([]);
        mocks.ownsMutation.mockReturnValue(true);
    });

    afterEach(() => {
        takeLaneStore.set({ lanes: [] });
    });

    describe('execute', () => {
        it('removes clip directly if track state is missing', () => {
            const result = handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(result).toBeUndefined();
            expect(mocks.removeClip).toHaveBeenCalledTimes(1);
            expect(mocks.removeClip).toHaveBeenCalledWith('c1');
            expect(mocks.rippleDeleteClips).not.toHaveBeenCalled();
            expect(mocks.removeMidiClipData).not.toHaveBeenCalled();
        });

        it('removes clip directly if clip is not found in tracks', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [] }] });

            const result = handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(result).toBeUndefined();
            expect(mocks.removeClip).toHaveBeenCalledTimes(1);
            expect(mocks.removeClip).toHaveBeenCalledWith('c1');
            expect(mocks.removeMidiClipData).not.toHaveBeenCalled();
        });

        it('attempts ripple delete and falls back to regular remove if ripple returns null', () => {
            const clip = createTestClip({ id: 'c1', startBeat: 0, endBeat: 1 });
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 't1', clips: [clip] }],
            });

            const result = handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(result).toBeUndefined();
            expect(mocks.rippleDeleteClips).toHaveBeenCalledWith({ trackId: 't1', clipIds: ['c1'] });
            expect(mocks.removeClip).toHaveBeenCalledTimes(1);
            expect(mocks.removeClip).toHaveBeenCalledWith('c1');
            expect(mocks.removeMidiClipData).not.toHaveBeenCalled();
        });

        it('surfaces a stale false ripple result instead of silently taking the fallback', () => {
            const clip = createTestClip({ id: 'c1', startBeat: 0, endBeat: 1 });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [clip] }] });
            // @ts-expect-error -- Regression injects the retired boolean result outside the object|null contract.
            mocks.rippleDeleteClips.mockReturnValue(false);

            expect(() => handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } })).toThrow();
            expect(mocks.removeClip).not.toHaveBeenCalled();
            expect(mocks.removeMidiClipData).not.toHaveBeenCalled();
        });

        it('cleans every ripple-removed clip in one MIDI owner call after the ripple mutation', () => {
            const clip1 = createTestClip({ id: 'c1', startBeat: 0, endBeat: 1 });
            const clip2 = createTestClip({ id: 'c2', startBeat: 1, endBeat: 2 });
            const removedClips: TestClip[] = [clip1, clip2];
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [clip1] }] });
            mocks.rippleDeleteClips.mockReturnValue({
                removedClips,
                shiftedClips: [],
                clipSatellites: [],
                clipAutomationLanes: [],
                retiredTakeLanes: [],
            });

            const result = handleRemoveClip.execute({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(result).toBeUndefined();
            expect(mocks.rippleDeleteClips).toHaveBeenCalledWith({ trackId: 't1', clipIds: ['c1'] });
            expect(mocks.removeClip).not.toHaveBeenCalled();
            expect(mocks.removeMidiClipData).toHaveBeenCalledTimes(1);
            expect(mocks.removeMidiClipData).toHaveBeenCalledWith(['c1', 'c2']);

            const rippleMutationOrder = mocks.rippleDeleteClips.mock.invocationCallOrder[0] ?? 0;
            const midiCleanupOrder = mocks.removeMidiClipData.mock.invocationCallOrder[0] ?? 0;
            expect(rippleMutationOrder).toBeLessThan(midiCleanupOrder);
        });
    });

    describe('execution-prefix capture', () => {
        it.each([
            ['fallback', 1],
            ['fallback', 0],
            ['fallback', -2],
            ['ripple', 1],
            ['ripple', 0],
            ['ripple', -2],
        ] as const)('refreshes the initial %s inverse from the executed source %s', (route, seconds) => {
            const clip = createTestClip({ id: 'c1', startBeat: 8, endBeat: 12 });
            clip.type = 'audio';
            clip.audioOffsetBeats = 2;
            const state = { tracks: [{ id: 't1', clips: [clip] }] };
            mocks.getTrackStoreState.mockReturnValue(state);
            const action = { type: 'removeClip' as const, payload: { clipId: clip.id } };
            const description = handleRemoveClip.describe(action);
            expect(description.inverseAction).toMatchObject({ payload: { clipSnapshot: { audioOffsetBeats: 2 } } });

            // A preceding batch member materializes the canonical source after describe.
            clip.audioOffsetSeconds = seconds;
            clip.audioOffsetBeats = seconds;
            const plan = {
                removedClips: [clip],
                shiftedClips: [],
                clipSatellites: [],
                clipAutomationLanes: [],
                retiredTakeLanes: [],
            };
            if (route === 'ripple') {
                mocks.planRippleDelete.mockReturnValue(plan);
                mocks.rippleDeleteClips.mockImplementation(() => {
                    state.tracks[0]!.clips = [];
                    return plan;
                });
            } else {
                mocks.removeClip.mockImplementation(() => {
                    state.tracks[0]!.clips = [];
                });
            }
            handleRemoveClip.execute(action);
            if (description.inverseAction?.type !== 'restoreClip') {
                throw new Error('Expected the execution-prefix restore capture');
            }
            expect(description.inverseAction.payload.clipSnapshot).toMatchObject({ audioOffsetSeconds: seconds });
            if (route === 'ripple') {
                expect(description.inverseAction.payload.ripplePlan?.removedClips[0]).toMatchObject({
                    audioOffsetSeconds: seconds,
                });
            } else {
                expect(description.inverseAction.payload.ripplePlan).toBeNull();
            }
            clip.audioOffsetSeconds = 99;
            expect(description.inverseAction.payload.clipSnapshot).toMatchObject({ audioOffsetSeconds: seconds });
        });

        it('discards a prepared capture when batch validation refuses a shared target', () => {
            const clip = createTestClip({ id: 'c1', startBeat: 8, endBeat: 12 });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [clip] }] });
            const action = { type: 'removeClip' as const, payload: { clipId: clip.id } };
            const description = handleRemoveClip.describe(action);
            expect(handleRemoveClip.validate?.(action, { actions: [action, action], actionIndex: 0 })).toBe(false);
            expect(description.inverseAction).toBeNull();
        });

        it('does not retain a capture described for an isolated preview', () => {
            const clip = createTestClip({ id: 'c1', startBeat: 8, endBeat: 12 });
            const state = { tracks: [{ id: 't1', clips: [clip] }] };
            mocks.getTrackStoreState.mockReturnValue(state);
            const action = { type: 'removeClip' as const, payload: { clipId: clip.id } };
            const description = handleRemoveClip.describe(action, {
                actions: [action],
                actionIndex: 0,
                executionMode: 'isolated-preview',
            });
            clip.audioOffsetSeconds = 1;
            mocks.removeClip.mockImplementationOnce(() => {
                state.tracks[0]!.clips = [];
            });
            handleRemoveClip.execute(action);
            expect(description.inverseAction).toMatchObject({ payload: { clipSnapshot: { id: clip.id } } });
            if (description.inverseAction?.type !== 'restoreClip') {
                throw new Error('Expected the description-only preview capture');
            }
            expect(description.inverseAction.payload.clipSnapshot).not.toHaveProperty('audioOffsetSeconds');
        });

        it.each(['no-write', 'throw', 'foreign-owner'] as const)(
            'discards the initial pending inverse after %s and cannot reuse it on a later execution',
            (outcome) => {
                const clip = createTestClip({ id: 'c1', startBeat: 8, endBeat: 12 });
                const state = { tracks: [{ id: 't1', clips: [clip] }] };
                mocks.getTrackStoreState.mockReturnValue(state);
                const action = { type: 'removeClip' as const, payload: { clipId: clip.id } };
                const description = handleRemoveClip.describe(action);
                if (outcome === 'throw') {
                    mocks.removeClip.mockImplementationOnce(() => {
                        state.tracks[0]!.clips = [];
                        throw new Error('Controlled removal failure');
                    });
                    expect(() => handleRemoveClip.execute(action)).toThrow('Controlled removal failure');
                } else {
                    if (outcome === 'foreign-owner') {
                        mocks.removeClip.mockImplementationOnce(() => {
                            state.tracks[0]!.clips = [];
                            mocks.ownsMutation.mockReturnValue(false);
                        });
                    }
                    handleRemoveClip.execute(action);
                }
                expect(description.inverseAction).toBeNull();

                // Reusing the caller's object without a new describe must never fill that discarded capture.
                state.tracks[0]!.clips = [{ ...clip, audioOffsetSeconds: 7 }];
                mocks.ownsMutation.mockReturnValue(true);
                mocks.removeClip.mockImplementationOnce(() => {
                    state.tracks[0]!.clips = [];
                });
                handleRemoveClip.execute(action);
                expect(description.inverseAction).toBeNull();
            }
        );
    });

    describe('describe', () => {
        it('returns simple label if state or clip is missing', () => {
            const desc = handleRemoveClip.describe({ type: 'removeClip', payload: { clipId: 'c1' } });
            expect(desc).toEqual({ label: 'Remove clip' });
        });

        it('returns simple label when state exists but no track owns the clip', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 't1', clips: [createTestClip({ id: 'other', startBeat: 0, endBeat: 1 })] }],
            });

            const desc = handleRemoveClip.describe({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(desc).toEqual({ label: 'Remove clip' });
        });

        it('uses the exact clip name in the execution receipt label', () => {
            const clip = createTestClip({ id: 'c1', startBeat: 0, endBeat: 1 });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [clip] }] });

            const desc = handleRemoveClip.describe({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(desc.label).toBe('Remove clip "Clip c1"');
        });

        it('omits the ripple plan when ripple editing yields no plan', () => {
            const clip = createTestClip({ id: 'c1', startBeat: 0, endBeat: 1 });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [clip] }] });
            mocks.planRippleDelete.mockReturnValue(null);

            const desc = handleRemoveClip.describe({ type: 'removeClip', payload: { clipId: 'c1' } });

            if (!desc.inverseAction || desc.inverseAction.type !== 'restoreClip') {
                throw new Error('Expected a restoreClip inverse action');
            }
            expect(desc.inverseAction.payload.ripplePlan).toBeNull();
        });

        it('captures the removed clip gain envelope, warp state, and automation lanes into the ripple plan', () => {
            const clip = createTestClip({ id: 'c1', startBeat: 0, endBeat: 1 });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [clip] }] });
            mocks.planRippleDelete.mockReturnValue({
                removedClips: [createTestClip({ id: 'c1', startBeat: 0, endBeat: 1 })],
                shiftedClips: [],
                clipSatellites: [],
                clipAutomationLanes: [],
                retiredTakeLanes: [],
            });
            const gainEnvelope = { clipId: 'c1', points: [{ id: 'p1', beatOffset: 0, gainDb: -6 }], enabled: true };
            mocks.readClipSatelliteEntry.mockReturnValue({ clipId: 'c1', gainEnvelope, warpState: null });
            const lane = { id: 'lane-1', clipId: 'c1' };
            mocks.readClipScopedAutomationLanes.mockReturnValue([lane]);

            const desc = handleRemoveClip.describe({ type: 'removeClip', payload: { clipId: 'c1' } });

            if (!desc.inverseAction || desc.inverseAction.type !== 'restoreClip') {
                throw new Error('Expected a restoreClip inverse action');
            }
            expect(desc.inverseAction.payload.ripplePlan?.clipSatellites).toEqual([
                { clipId: 'c1', gainEnvelope, warpState: null },
            ]);
            expect(desc.inverseAction.payload.ripplePlan?.clipAutomationLanes).toEqual([lane]);
        });

        it('records null MIDI snapshots when the clip has no MIDI data', () => {
            const clip = createTestClip({ id: 'c1', startBeat: 0, endBeat: 1 });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [clip] }] });
            mocks.planRippleDelete.mockReturnValue({
                removedClips: [createTestClip({ id: 'c1', startBeat: 0, endBeat: 1 })],
                shiftedClips: [],
                clipSatellites: [],
                clipAutomationLanes: [],
                retiredTakeLanes: [],
            });
            // No MIDI store -> every snapshot falls through to null.
            mocks.getMidiStoreState.mockReturnValue(null);

            const desc = handleRemoveClip.describe({ type: 'removeClip', payload: { clipId: 'c1' } });

            if (!desc.inverseAction || desc.inverseAction.type !== 'restoreClip') {
                throw new Error('Expected a restoreClip inverse action');
            }
            expect(desc.inverseAction.payload.midiNotesSnapshot).toBeNull();
            expect(desc.inverseAction.payload.midiCcSnapshot).toBeNull();
            expect(desc.inverseAction.payload.midiPitchBendSnapshot).toBeNull();
        });

        it('returns inverse action with full clip and MIDI snapshots', () => {
            const mockClip = createTestClip({ id: 'c1', startBeat: 0, endBeat: 1 });
            const rippleRemovedClip = createTestClip({ id: 'c1', startBeat: 0, endBeat: 1 });
            const rippleShift = { clipId: 'c2', origStartBeat: 1, origEndBeat: 2, automationDelta: -1 };
            const ripplePlanSource = {
                removedClips: [rippleRemovedClip],
                shiftedClips: [rippleShift],
                clipSatellites: [],
                clipAutomationLanes: [],
            };
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [mockClip] }] });
            mocks.planRippleDelete.mockReturnValue({ ...ripplePlanSource, retiredTakeLanes: [] });

            const mockMidiNote = { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
            const mockMidiCc = { id: 'cc1', controller: 1, value: 64, beat: 0.5, channel: 1 };
            const mockMidiPitchBend = { id: 'pb1', value: 256, beat: 0.75, channel: 1 };
            const mockMidiNotes = [mockMidiNote];
            const mockMidiCcs = [mockMidiCc];
            const mockMidiPitchBends = [mockMidiPitchBend];
            mocks.getMidiStoreState.mockReturnValue({
                probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
                notesByClipId: { c1: mockMidiNotes },
                ccByClipId: { c1: mockMidiCcs },
                pitchBendByClipId: { c1: mockMidiPitchBends },
            });
            // A real take names the removed clip, so the capture the inverse carries
            // is distinguishable from no capture at all.
            const capturedLane = {
                id: 'lane-1',
                trackId: 't1',
                takes: [{ id: 'take-1', clipId: 'c1', name: 'Take 1', startBeat: 0, endBeat: 4, selected: false }],
                activeCompRegions: [],
            };
            takeLaneStore.set({ lanes: [capturedLane] });

            const desc = handleRemoveClip.describe({ type: 'removeClip', payload: { clipId: 'c1' } });

            expect(desc.label).toBe('Remove clip "Clip c1"');
            expect(mocks.getMidiStoreState).toHaveBeenCalledTimes(1);

            if (!desc.inverseAction || desc.inverseAction.type !== 'restoreClip') {
                throw new Error('Expected a restoreClip inverse action');
            }

            expect(desc.inverseAction.payload).toMatchObject({
                clipId: 'c1',
                trackId: 't1',
                clipSnapshot: mockClip,
                ripplePlan: ripplePlanSource,
                midiNotesSnapshot: mockMidiNotes,
                midiCcSnapshot: mockMidiCcs,
                midiPitchBendSnapshot: mockMidiPitchBends,
            });
            expect(desc.inverseAction.payload.retiredTakeLanes).toEqual([
                { laneIndex: 0, lane: capturedLane, retiredTakeIds: ['take-1'] },
            ]);
            expect(desc.inverseAction.payload.clipSnapshot).not.toBe(mockClip);
            expect(desc.inverseAction.payload.ripplePlan).not.toBe(ripplePlanSource);
            expect(desc.inverseAction.payload.ripplePlan?.removedClips).not.toBe(ripplePlanSource.removedClips);
            expect(desc.inverseAction.payload.ripplePlan?.shiftedClips).not.toBe(ripplePlanSource.shiftedClips);
            expect(desc.inverseAction.payload.midiNotesSnapshot).not.toBe(mockMidiNotes);
            expect(desc.inverseAction.payload.midiCcSnapshot).not.toBe(mockMidiCcs);
            expect(desc.inverseAction.payload.midiPitchBendSnapshot).not.toBe(mockMidiPitchBends);

            mockClip.startBeat = 99;
            rippleRemovedClip.startBeat = 99;
            rippleShift.origStartBeat = 99;
            mockMidiNote.pitch = 72;
            mockMidiCc.value = 127;
            mockMidiPitchBend.value = 1024;

            expect(desc.inverseAction.payload.clipSnapshot.startBeat).toBe(0);
            expect(desc.inverseAction.payload.ripplePlan?.removedClips[0]?.startBeat).toBe(0);
            expect(desc.inverseAction.payload.ripplePlan?.shiftedClips[0]?.origStartBeat).toBe(1);
            expect(desc.inverseAction.payload.midiNotesSnapshot).toEqual([
                { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
            ]);
            expect(desc.inverseAction.payload.midiCcSnapshot).toEqual([
                { id: 'cc1', controller: 1, value: 64, beat: 0.5, channel: 1 },
            ]);
            expect(desc.inverseAction.payload.midiPitchBendSnapshot).toEqual([
                { id: 'pb1', value: 256, beat: 0.75, channel: 1 },
            ]);
        });
    });

    it('is undoable', () => {
        expect(handleRemoveClip.undoable).toBe(true);
    });
});

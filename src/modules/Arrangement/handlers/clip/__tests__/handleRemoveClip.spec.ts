import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LEGACY_MIDI_PROBABILITY_SEED, type MidiStoreState } from '#/modules/MIDI/stores';

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

vi.mock('#/modules/MIDI/useCases', () => ({
    getMidiStoreState: mocks.getMidiStoreState,
    removeMidiClipData: mocks.removeMidiClipData,
}));

vi.mock('../../../stores/clipSatelliteState', () => ({
    readClipSatelliteEntry: mocks.readClipSatelliteEntry,
}));

vi.mock('../../../useCases/clip/clipAutomationLaneTransition', () => ({
    readClipScopedAutomationLanes: mocks.readClipScopedAutomationLanes,
}));

describe('handleRemoveClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
            mocks.planRippleDelete.mockReturnValue(ripplePlanSource);

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

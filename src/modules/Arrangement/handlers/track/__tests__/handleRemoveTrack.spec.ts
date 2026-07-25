import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { handleRemoveTrack } from '../handleRemoveTrack';

function createAutomationLane(id: string, trackId: string) {
    return {
        id,
        trackId,
        parameterId: `parameter-${id}`,
        parameterName: `Parameter ${id}`,
        points: [],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function createMidiNote(id: string, pitch: number) {
    return { id, pitch, startBeat: 0, duration: 1, velocity: 100 };
}

function createMidiControlChange(id: string, value: number) {
    return { id, controller: 1, value, beat: 0, channel: 0 };
}

function createMidiPitchBend(id: string, value: number) {
    return { id, value, beat: 0, channel: 0 };
}

function createTakeLane(id: string, trackId: string) {
    return { id, trackId, takes: [], activeCompRegions: [] };
}

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    removeTrack: vi.fn(),
    removeModulator: vi.fn(),
    removeMapping: vi.fn(),
    automationStoreValue: { value: null } as any,
    modulationStoreValue: { value: null } as any,
    midiStoreValue: { value: null } as any,
    takeLaneStoreValue: { value: null } as any,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/removeTrack', () => ({
    removeTrack: mocks.removeTrack,
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: {
        get value() {
            return mocks.automationStoreValue.value;
        },
    },
    modulationStore: {
        get value() {
            return mocks.modulationStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Automation/useCases', () => ({
    removeModulator: mocks.removeModulator,
    removeMapping: mocks.removeMapping,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
    },
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
    },
}));

describe('handleRemoveTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.automationStoreValue.value = null;
        mocks.modulationStoreValue.value = null;
        mocks.midiStoreValue.value = null;
        mocks.takeLaneStoreValue.value = null;
    });

    describe('execute', () => {
        it('calls removeTrack with the provided trackId', () => {
            void handleRemoveTrack.execute({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });
            expect(mocks.removeTrack).toHaveBeenCalledWith('t1');
        });

        it('reconciles modulation: removes modulators owned by the track and mappings that target it', () => {
            // m1 is owned by the removed track (t1) → its bindings can never resolve.
            // m2 lives on another track (t2) but maps INTO t1 → that mapping dangles.
            // m2 also has a mapping to t3 that must be left alone.
            mocks.modulationStoreValue.value = {
                modulators: [
                    { id: 'm1', trackId: 't1', mappings: [] },
                    {
                        id: 'm2',
                        trackId: 't2',
                        mappings: [
                            { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'cutoff' },
                            { targetTrackId: 't3', targetDeviceId: 'd9', targetParamId: 'gain' },
                        ],
                    },
                ],
            };

            void handleRemoveTrack.execute({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });

            // The owned modulator is removed by id.
            expect(mocks.removeModulator).toHaveBeenCalledTimes(1);
            expect(mocks.removeModulator).toHaveBeenCalledWith('m1');

            // The cross-track mapping that targets t1 is removed by (modulatorId, target).
            expect(mocks.removeMapping).toHaveBeenCalledTimes(1);
            expect(mocks.removeMapping).toHaveBeenCalledWith('m2', {
                targetTrackId: 't1',
                targetDeviceId: 'd1',
                targetParamId: 'cutoff',
            });

            // The mapping into the surviving track t3 is left intact.
            expect(mocks.removeMapping).not.toHaveBeenCalledWith(
                'm2',
                expect.objectContaining({ targetTrackId: 't3' })
            );
        });

        it('does not reconcile modulation when the modulation store is empty', () => {
            mocks.modulationStoreValue.value = null;

            void handleRemoveTrack.execute({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });

            expect(mocks.removeModulator).not.toHaveBeenCalled();
            expect(mocks.removeMapping).not.toHaveBeenCalled();
        });
    });

    describe('describe', () => {
        it('returns simple label if track is not found', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const desc = handleRemoveTrack.describe({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });

            expect(desc.label).toBe('Remove track');
            expect('inverseAction' in desc).toBe(false);
        });

        it('returns inverse action with full snapshot state', () => {
            const activeClip = ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' });
            const activeAlternativeClip = ClipDummy.create({ id: 'c2', trackId: 't1', type: 'midi' });
            const inactiveAlternativeClip = ClipDummy.create({ id: 'c3', trackId: 't1', type: 'midi' });
            const track = TrackDummy.create({
                id: 't1',
                name: 'Vocals',
                kind: 'midi',
                clips: [activeClip],
                activeAlternativeId: 'alt-active',
                alternatives: [
                    { id: 'alt-active', name: 'Active', clips: [activeClip, activeAlternativeClip] },
                    { id: 'alt-inactive', name: 'Inactive', clips: [inactiveAlternativeClip, activeClip] },
                ],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const removedAutomationLane = createAutomationLane('l1', 't1');
            const unrelatedAutomationLane = createAutomationLane('l2', 't2');
            mocks.automationStoreValue.value = {
                lanes: [removedAutomationLane, unrelatedAutomationLane],
            };

            const noteC1 = createMidiNote('note-c1', 60);
            const noteC2 = createMidiNote('note-c2', 61);
            const noteC3 = createMidiNote('note-c3', 62);
            const unrelatedNote = createMidiNote('note-unrelated', 64);
            const ccC1 = createMidiControlChange('cc-c1', 10);
            const ccC2 = createMidiControlChange('cc-c2', 11);
            const ccC3 = createMidiControlChange('cc-c3', 12);
            const unrelatedCc = createMidiControlChange('cc-unrelated', 14);
            const pitchBendC1 = createMidiPitchBend('pitch-bend-c1', 0);
            const pitchBendC2 = createMidiPitchBend('pitch-bend-c2', 1);
            const pitchBendC3 = createMidiPitchBend('pitch-bend-c3', 2);
            const unrelatedPitchBend = createMidiPitchBend('pitch-bend-unrelated', 4);
            mocks.midiStoreValue.value = {
                notesByClipId: {
                    c1: [noteC1],
                    c2: [noteC2],
                    c3: [noteC3],
                    unrelated: [unrelatedNote],
                },
                ccByClipId: {
                    c1: [ccC1],
                    c2: [ccC2],
                    c3: [ccC3],
                    unrelated: [unrelatedCc],
                },
                pitchBendByClipId: {
                    c1: [pitchBendC1],
                    c2: [pitchBendC2],
                    c3: [pitchBendC3],
                    unrelated: [unrelatedPitchBend],
                },
            };

            const removedTakeLane = createTakeLane('take1', 't1');
            const unrelatedTakeLane = createTakeLane('take2', 't2');
            mocks.takeLaneStoreValue.value = {
                lanes: [removedTakeLane, unrelatedTakeLane],
            };

            const desc = handleRemoveTrack.describe({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });

            expect(desc.label).toBe('Remove track');
            expect(desc.inverseAction).toBeDefined();

            const inverseAction = desc.inverseAction;
            if (!inverseAction || inverseAction.type !== 'restoreTrack') {
                throw new Error('expected a restoreTrack inverse action');
            }

            const payload = inverseAction.payload;
            expect(payload.trackId).toBe('t1');
            expect(payload.trackSnapshot).toEqual(track);
            expect(payload.automationLaneSnapshots).toEqual([removedAutomationLane]);
            expect(payload.takeLaneSnapshots).toEqual([removedTakeLane]);

            expect(payload.midiNotesByClipId).toEqual({
                c1: [noteC1],
                c2: [noteC2],
                c3: [noteC3],
            });
            expect(payload.midiCcByClipId).toEqual({
                c1: [ccC1],
                c2: [ccC2],
                c3: [ccC3],
            });
            expect(payload.midiPitchBendByClipId).toEqual({
                c1: [pitchBendC1],
                c2: [pitchBendC2],
                c3: [pitchBendC3],
            });
        });

        it('omits clip ids that have no midi data and skips automation when the store is empty', () => {
            // Track has two midi clips: c1 carries notes+cc+pitch-bend; c2 has none.
            const clipC1 = ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' });
            const clipC2 = ClipDummy.create({ id: 'c2', trackId: 't1', type: 'midi' });
            const track = TrackDummy.create({ id: 't1', name: 'Vocals', kind: 'midi', clips: [clipC1, clipC2] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            // automationStore is null -> the `?: []` fallback arm fires (no lanes captured).
            mocks.automationStoreValue.value = null;

            const noteC1 = createMidiNote('note-c1', 60);
            const ccC1 = createMidiControlChange('cc-c1', 10);
            const pitchBendC1 = createMidiPitchBend('pitch-bend-c1', 0);
            mocks.midiStoreValue.value = {
                // Only c1 has entries; c2 is absent for every kind -> skipped branches fire.
                notesByClipId: { c1: [noteC1] },
                ccByClipId: { c1: [ccC1] },
                pitchBendByClipId: { c1: [pitchBendC1] },
            };

            const desc = handleRemoveTrack.describe({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });

            const inverseAction = desc.inverseAction;
            if (!inverseAction || inverseAction.type !== 'restoreTrack') {
                throw new Error('expected a restoreTrack inverse action');
            }
            const payload = inverseAction.payload;
            // c1 captured, c2 omitted entirely (no entries of any kind).
            expect(payload.midiNotesByClipId).toEqual({ c1: [noteC1] });
            expect(payload.midiCcByClipId).toEqual({ c1: [ccC1] });
            expect(payload.midiPitchBendByClipId).toEqual({ c1: [pitchBendC1] });
            // Automation store was null -> empty snapshot.
            expect(payload.automationLaneSnapshots).toEqual([]);
        });
    });

    it('is undoable', () => {
        expect(handleRemoveTrack.undoable).toBe(true);
    });
});

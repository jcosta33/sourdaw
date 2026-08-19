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
    publishTrackRemoved: vi.fn(),
    finalizeRuntimeRemoval: vi.fn(),
    finalizeModulationRemoval: vi.fn(),
    projectTrackToLiveStrip: vi.fn(),
    wireSidechainRoutes: vi.fn(),
    removeTrackModulationReferences: vi.fn(),
    getVcaGroupsState: vi.fn(),
    automationStoreValue: { value: null } as any,
    modulationStoreValue: { value: null } as any,
    getAllSidechainRoutes: vi.fn(),
    midiStoreValue: { value: null } as any,
    takeLaneStoreValue: { value: null } as any,
    readClipSatelliteEntry: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/removeTrack', () => ({
    removeTrack: mocks.removeTrack,
}));
vi.mock('../../../useCases/publishTrackRemoved', () => ({
    publishTrackRemoved: mocks.publishTrackRemoved,
}));
vi.mock('../../../useCases/removeTrackModulationReferences', () => ({
    removeTrackModulationReferences: mocks.removeTrackModulationReferences,
}));
vi.mock('../../../useCases/projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
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

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Routing/useCases', () => ({
    getAllSidechainRoutes: mocks.getAllSidechainRoutes,
    wireSidechainRoutes: mocks.wireSidechainRoutes,
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
    },
}));

vi.mock('../../../stores/vcaGroupStore', () => ({
    getVcaGroupsState: mocks.getVcaGroupsState,
}));

vi.mock('../../../stores/clipSatelliteState', () => ({
    readClipSatelliteEntry: mocks.readClipSatelliteEntry,
}));

describe('handleRemoveTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.automationStoreValue.value = null;
        mocks.modulationStoreValue.value = null;
        mocks.midiStoreValue.value = null;
        mocks.takeLaneStoreValue.value = null;
        mocks.getAllSidechainRoutes.mockReturnValue([]);
        mocks.getVcaGroupsState.mockReturnValue([]);
        mocks.readClipSatelliteEntry.mockImplementation((clipId: string) => ({
            clipId,
            gainEnvelope: null,
            warpState: null,
        }));
        mocks.removeTrack.mockReturnValue({
            removed: true,
            finalizeRuntimeRemoval: mocks.finalizeRuntimeRemoval,
        });
        mocks.removeTrackModulationReferences.mockReturnValue({
            afterCommit: mocks.finalizeModulationRemoval,
            afterAmbiguousCommit: mocks.finalizeModulationRemoval,
        });
    });

    describe('execute', () => {
        it('rejects an alternative-content guard mismatch before project or runtime removal', async () => {
            const alternativeClip = ClipDummy.create({ id: 'c-hidden', trackId: 't1' });
            const track = TrackDummy.create({
                id: 't1',
                alternatives: [{ id: 'alt-hidden', name: 'Hidden', clips: [alternativeClip] }],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track], selectedTrackId: null });

            const result = await handleRemoveTrack.execute({
                type: 'removeTrack',
                payload: { trackId: 't1', expectedAlternativeClipIds: [] },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.removeTrack).not.toHaveBeenCalled();
            expect(mocks.removeTrackModulationReferences).not.toHaveBeenCalled();
            expect(mocks.finalizeRuntimeRemoval).not.toHaveBeenCalled();
        });

        it('rejects either VCA membership guard mismatch before project or runtime removal', async () => {
            const track = TrackDummy.create({ id: 't1', vcaGroupId: 'vca-linked' });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track], selectedTrackId: null });
            mocks.getVcaGroupsState.mockReturnValue([
                { id: 'vca-authoritative', name: 'VCA', gain: 1, muted: false, trackIds: ['t1'] },
            ]);

            const trackGuardResult = await handleRemoveTrack.execute({
                type: 'removeTrack',
                payload: { trackId: 't1', expectedVcaGroupId: null },
            });
            const groupGuardResult = await handleRemoveTrack.execute({
                type: 'removeTrack',
                payload: {
                    trackId: 't1',
                    expectedVcaGroupId: 'vca-linked',
                    expectedVcaMembershipGroupIds: [],
                },
            });

            expect(trackGuardResult).toEqual({ status: 'conflict' });
            expect(groupGuardResult).toEqual({ status: 'conflict' });
            expect(mocks.removeTrack).not.toHaveBeenCalled();
            expect(mocks.removeTrackModulationReferences).not.toHaveBeenCalled();
            expect(mocks.finalizeRuntimeRemoval).not.toHaveBeenCalled();
        });

        it('removes the track and publishes only after commit', async () => {
            const result = await handleRemoveTrack.execute({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });

            expect(mocks.removeTrack).toHaveBeenCalledWith('t1', {
                deferRuntimeEffects: true,
                suppressRemovedEvent: true,
            });
            expect(mocks.finalizeRuntimeRemoval).not.toHaveBeenCalled();
            expect(mocks.finalizeModulationRemoval).not.toHaveBeenCalled();
            expect(mocks.publishTrackRemoved).not.toHaveBeenCalled();
            expect(mocks.removeTrackModulationReferences).toHaveBeenCalledWith({
                trackId: 't1',
                deferRuntimeEffects: true,
            });

            await result?.afterCommit?.();

            expect(mocks.finalizeRuntimeRemoval).toHaveBeenCalledOnce();
            expect(mocks.finalizeModulationRemoval).toHaveBeenCalledOnce();
            expect(mocks.publishTrackRemoved).toHaveBeenCalledWith({ trackId: 't1' });
        });

        it('attempts every required post-commit effect when one fails', async () => {
            const failure = new Error('strip cleanup failed');
            mocks.finalizeRuntimeRemoval.mockImplementationOnce(() => {
                throw failure;
            });
            const result = await handleRemoveTrack.execute({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });

            await expect(result?.afterCommit?.()).rejects.toBe(failure);

            expect(mocks.finalizeModulationRemoval).toHaveBeenCalledOnce();
            expect(mocks.publishTrackRemoved).toHaveBeenCalledWith({ trackId: 't1' });
        });

        it('rebuilds a track that remains in durable truth after an ambiguous commit', async () => {
            const track = TrackDummy.create({ id: 't1' });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track], selectedTrackId: null });
            const result = await handleRemoveTrack.execute({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });

            await result?.afterAmbiguousCommit?.();

            expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledWith({
                trackId: 't1',
                activateDormantExternalPlugins: true,
            });
            expect(mocks.finalizeRuntimeRemoval).not.toHaveBeenCalled();
            expect(mocks.publishTrackRemoved).not.toHaveBeenCalled();
            expect(mocks.wireSidechainRoutes).toHaveBeenCalledOnce();
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
            const routedSurvivor = TrackDummy.create({
                id: 't2',
                outputId: 't1',
                sends: [{ busId: 't1', level: 0.5, preFader: false }],
            });
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [track, routedSurvivor],
                selectedTrackId: 't1',
            });

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
            const removedSidechainRoute = {
                id: 'sidechain-removed',
                sourceTrackId: 't2',
                targetTrackId: 't1',
                targetDeviceId: 'device-1',
                targetParameterId: 'threshold',
                gain: 0.75,
            };
            const unrelatedSidechainRoute = {
                ...removedSidechainRoute,
                id: 'sidechain-unrelated',
                targetTrackId: 't3',
            };
            mocks.getAllSidechainRoutes.mockReturnValue([removedSidechainRoute, unrelatedSidechainRoute]);
            const ownedModulator = {
                id: 'mod-owned',
                name: 'Owned LFO',
                trackId: 't1',
                kind: 'lfo',
                config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                mappings: [],
                enabled: true,
            };
            const incomingMapping = {
                targetTrackId: 't1',
                targetDeviceId: 'device-1',
                targetParamId: 'cutoff',
                amount: 0.5,
            };
            mocks.modulationStoreValue.value = {
                modulators: [
                    ownedModulator,
                    {
                        ...ownedModulator,
                        id: 'mod-survivor',
                        trackId: 't2',
                        mappings: [incomingMapping, { ...incomingMapping, targetTrackId: 't3', targetParamId: 'gain' }],
                    },
                ],
            };

            const desc = handleRemoveTrack.describe({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });

            expect(desc.label).toBe('Remove track "Vocals"');
            expect(desc.inverseAction).toBeDefined();

            const inverseAction = desc.inverseAction;
            if (!inverseAction || inverseAction.type !== 'restoreTrack') {
                throw new Error('expected a restoreTrack inverse action');
            }

            const payload = inverseAction.payload;
            expect(payload.trackId).toBe('t1');
            expect(payload.trackSnapshot).toEqual(track);
            expect(payload.trackName).toBe(track.name);
            expect(payload.trackKind).toBe(track.kind);
            expect(payload.trackGain).toBe(track.gain);
            expect(payload.trackParentId).toBe(track.parentId);
            expect(payload.trackIndex).toBe(0);
            expect(payload.wasSelected).toBe(true);
            expect(payload.routingPatches).toEqual([
                {
                    trackId: routedSurvivor.id,
                    expected: { outputId: track.outputId, sends: [] },
                    replacement: { outputId: routedSurvivor.outputId, sends: routedSurvivor.sends },
                },
            ]);
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
            expect(payload.sidechainRouteSnapshots).toEqual([removedSidechainRoute]);
            expect(payload.ownedModulatorSnapshots).toEqual([ownedModulator]);
            expect(payload.incomingModulationMappingSnapshots).toEqual([
                { modulatorId: 'mod-survivor', mapping: incomingMapping },
            ]);
        });

        it('captures the gain envelope and warp state of every clip on the removed track (regression #2108)', () => {
            const clipWithSatellites = ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' });
            const clipWithoutSatellites = ClipDummy.create({ id: 'c2', trackId: 't1', type: 'midi' });
            const track = TrackDummy.create({
                id: 't1',
                name: 'Vocals',
                kind: 'midi',
                clips: [clipWithSatellites, clipWithoutSatellites],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track], selectedTrackId: null });
            const gainEnvelope = { clipId: 'c1', points: [{ id: 'p1', beatOffset: 0, gainDb: -6 }], enabled: true };
            mocks.readClipSatelliteEntry.mockImplementation((clipId: string) =>
                clipId === 'c1' ? { clipId, gainEnvelope, warpState: null } : { clipId, gainEnvelope: null, warpState: null }
            );

            const desc = handleRemoveTrack.describe({
                type: 'removeTrack',
                payload: { trackId: 't1' },
            });

            const inverseAction = desc.inverseAction;
            if (!inverseAction || inverseAction.type !== 'restoreTrack') {
                throw new Error('expected a restoreTrack inverse action');
            }
            // Only the clip that actually carries a satellite is captured — a
            // bare clip does not bloat the inverse-action payload.
            expect(inverseAction.payload.clipSatellites).toEqual([{ clipId: 'c1', gainEnvelope, warpState: null }]);
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

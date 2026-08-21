import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { captureTrackRemovalSnapshot } from '../captureTrackRemovalSnapshot';

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
    getAllSidechainRoutes: vi.fn(),
    automationStoreValue: { value: null } as any,
    modulationStoreValue: { value: null } as any,
    midiStoreValue: { value: null } as any,
    takeLaneStoreValue: { value: null } as any,
}));

vi.mock('../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
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
}));

vi.mock('../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
    },
}));

describe('captureTrackRemovalSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.automationStoreValue.value = null;
        mocks.modulationStoreValue.value = null;
        mocks.midiStoreValue.value = null;
        mocks.takeLaneStoreValue.value = null;
        mocks.getAllSidechainRoutes.mockReturnValue([]);
    });

    it('returns null when the track does not exist', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        expect(captureTrackRemovalSnapshot('t1')).toBeNull();
    });

    it('captures the full removal snapshot: routing, automation, midi, take lanes, sidechain, modulation', () => {
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

        const snapshot = captureTrackRemovalSnapshot('t1');
        if (!snapshot) {
            throw new Error('expected a snapshot');
        }

        expect(snapshot.trackId).toBe('t1');
        expect(snapshot.trackSnapshot).toEqual(track);
        expect(snapshot.trackName).toBe(track.name);
        expect(snapshot.trackKind).toBe(track.kind);
        expect(snapshot.trackGain).toBe(track.gain);
        expect(snapshot.trackParentId).toBe(track.parentId);
        expect(snapshot.trackIndex).toBe(0);
        expect(snapshot.wasSelected).toBe(true);
        expect(snapshot.routingPatches).toEqual([
            {
                trackId: routedSurvivor.id,
                expected: { outputId: track.outputId, sends: [] },
                replacement: { outputId: routedSurvivor.outputId, sends: routedSurvivor.sends },
            },
        ]);
        expect(snapshot.automationLaneSnapshots).toEqual([removedAutomationLane]);
        expect(snapshot.takeLaneSnapshots).toEqual([removedTakeLane]);
        expect(snapshot.midiNotesByClipId).toEqual({
            c1: [noteC1],
            c2: [noteC2],
            c3: [noteC3],
        });
        expect(snapshot.midiCcByClipId).toEqual({
            c1: [ccC1],
            c2: [ccC2],
            c3: [ccC3],
        });
        expect(snapshot.midiPitchBendByClipId).toEqual({
            c1: [pitchBendC1],
            c2: [pitchBendC2],
            c3: [pitchBendC3],
        });
        expect(snapshot.sidechainRouteSnapshots).toEqual([removedSidechainRoute]);
        expect(snapshot.ownedModulatorSnapshots).toEqual([ownedModulator]);
        expect(snapshot.incomingModulationMappingSnapshots).toEqual([
            { modulatorId: 'mod-survivor', mapping: incomingMapping },
        ]);
    });

    it('omits clip ids that have no midi data and skips automation when the store is empty', () => {
        const clipC1 = ClipDummy.create({ id: 'c1', trackId: 't1', type: 'midi' });
        const clipC2 = ClipDummy.create({ id: 'c2', trackId: 't1', type: 'midi' });
        const track = TrackDummy.create({ id: 't1', name: 'Vocals', kind: 'midi', clips: [clipC1, clipC2] });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

        mocks.automationStoreValue.value = null;

        const noteC1 = createMidiNote('note-c1', 60);
        const ccC1 = createMidiControlChange('cc-c1', 10);
        const pitchBendC1 = createMidiPitchBend('pitch-bend-c1', 0);
        mocks.midiStoreValue.value = {
            notesByClipId: { c1: [noteC1] },
            ccByClipId: { c1: [ccC1] },
            pitchBendByClipId: { c1: [pitchBendC1] },
        };

        const snapshot = captureTrackRemovalSnapshot('t1');
        if (!snapshot) {
            throw new Error('expected a snapshot');
        }

        expect(snapshot.midiNotesByClipId).toEqual({ c1: [noteC1] });
        expect(snapshot.midiCcByClipId).toEqual({ c1: [ccC1] });
        expect(snapshot.midiPitchBendByClipId).toEqual({ c1: [pitchBendC1] });
        expect(snapshot.automationLaneSnapshots).toEqual([]);
    });
});

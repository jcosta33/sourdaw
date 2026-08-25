import { describe, it, expect, vi, beforeEach } from 'vitest';

import { midiLearnStore, type MidiMapping } from '../../../stores/midiLearnStore';
import { handleMidiMessage } from '../handleMidiMessage';
import { setMidiLearnDependencies } from '../midiLearnDependencies';
import { scaleMidiValue } from '../scaleMidiValue';

import type { Track } from '#/modules/Arrangement/stores';

const baseTrack: Track = {
    id: 'track1',
    name: 'Track 1',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    color: '#fff',
    clips: [],
    devices: [],
    sends: [],
    midiFx: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 80,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'alt-1',
    alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
};
const makeTrack = (overrides: Partial<Track> = {}): Track => ({ ...baseTrack, ...overrides });

const baseMapping: MidiMapping = {
    id: 'm1',
    channel: 0,
    cc: 7,
    targetType: 'trackGain',
    trackId: 'track1',
    minValue: 0,
    maxValue: 1,
    scaleMode: 'linear',
};

describe('handleMidiMessage', () => {
    const deps = {
        clampTrackGain: vi.fn((gain: number) => gain),
        setTrackGainArrangement: vi.fn(),
        setTrackPanArrangement: vi.fn(),
        setDeviceParameter: vi.fn(),
        engineSetTrackGain: vi.fn(),
        engineSetTrackPan: vi.fn(),
        setFermenterMappedParam: vi.fn(),
        recordAutomationValue: vi.fn(),
        getTransportIsPlaying: vi.fn(() => false),
        getTransportPlayheadPosition: vi.fn(() => 0),
        getAllTracks: vi.fn((): Track[] => []),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        deps.clampTrackGain.mockImplementation((gain: number) => gain);
        deps.getTransportIsPlaying.mockReturnValue(false);
        deps.getTransportPlayheadPosition.mockReturnValue(0);
        deps.getAllTracks.mockReturnValue([]);
        setMidiLearnDependencies(deps);
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [baseMapping],
            isLearning: false,
            learningTarget: null,
        });
    });

    it('does nothing when the store has no state', () => {
        midiLearnStore.set(null);

        handleMidiMessage(0, 7, 64);

        expect(deps.setTrackGainArrangement).not.toHaveBeenCalled();
    });

    it('does nothing when no mapping matches the channel/cc pair', () => {
        handleMidiMessage(1, 99, 64);

        expect(deps.setTrackGainArrangement).not.toHaveBeenCalled();
    });

    it('scales and writes trackGain to both arrangement and engine', () => {
        handleMidiMessage(0, 7, 127);

        expect(deps.setTrackGainArrangement).toHaveBeenCalledWith('track1', 1);
        expect(deps.engineSetTrackGain).toHaveBeenCalledWith('track1', 1);
    });

    it('sends the store and the engine the same resolved gain when the mapping overruns the fader ceiling', () => {
        // The engine-side call lands second and does not clamp on its own, so
        // the raw scaled value used to overwrite the clamped one the store-side
        // call had just installed: the audio node ran above the ceiling the
        // project had just recorded, and the two disagreed until something else
        // rewrote the node. Both calls now take one resolved value, so they
        // cannot disagree.
        deps.clampTrackGain.mockImplementation((gain: number) => Math.min(gain, 1));
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [{ ...baseMapping, maxValue: 2 }],
            isLearning: false,
            learningTarget: null,
        });

        handleMidiMessage(0, 7, 127);

        expect(deps.setTrackGainArrangement).toHaveBeenCalledWith('track1', 1);
        expect(deps.engineSetTrackGain).toHaveBeenCalledWith('track1', 1);
        expect(deps.engineSetTrackGain).not.toHaveBeenCalledWith('track1', 2);
    });

    it('scales and writes trackPan to both arrangement and engine', () => {
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [{ ...baseMapping, targetType: 'trackPan', minValue: -50, maxValue: 50 }],
            isLearning: false,
            learningTarget: null,
        });

        handleMidiMessage(0, 7, 0);

        expect(deps.setTrackPanArrangement).toHaveBeenCalledWith('track1', -50);
        expect(deps.engineSetTrackPan).toHaveBeenCalledWith('track1', -50);
    });

    it('skips a trackGain mapping with no trackId instead of writing an undefined target (F-11)', () => {
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [{ ...baseMapping, trackId: undefined }],
            isLearning: false,
            learningTarget: null,
        });

        handleMidiMessage(0, 7, 127);

        expect(deps.setTrackGainArrangement).not.toHaveBeenCalled();
        expect(deps.engineSetTrackGain).not.toHaveBeenCalled();
    });

    it('skips a trackPan mapping with no trackId instead of writing an undefined target (F-11)', () => {
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [{ ...baseMapping, targetType: 'trackPan', trackId: undefined, minValue: -50, maxValue: 50 }],
            isLearning: false,
            learningTarget: null,
        });

        handleMidiMessage(0, 7, 0);

        expect(deps.setTrackPanArrangement).not.toHaveBeenCalled();
        expect(deps.engineSetTrackPan).not.toHaveBeenCalled();
    });

    it('writes a deviceParam mapping only when both deviceId and paramId are set', () => {
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [{ ...baseMapping, targetType: 'deviceParam', deviceId: 'dev1', paramId: 'cutoff' }],
            isLearning: false,
            learningTarget: null,
        });

        handleMidiMessage(0, 7, 127);

        expect(deps.setDeviceParameter).toHaveBeenCalledWith('dev1', 'cutoff', 1);
    });

    it('routes fermenterGlobalParam to the first fermenter device found across all tracks', () => {
        const fermenterTrack = makeTrack({
            id: 'track2',
            devices: [{ id: 'ferm1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} }],
        });
        deps.getAllTracks.mockReturnValue([baseTrack, fermenterTrack]);
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [{ ...baseMapping, targetType: 'fermenterGlobalParam', paramId: 'mix' }],
            isLearning: false,
            learningTarget: null,
        });

        handleMidiMessage(0, 7, 127);

        expect(deps.setFermenterMappedParam).toHaveBeenCalledWith({ deviceId: 'ferm1', paramId: 'mix', value: 1 });
    });

    it('does not touch the fermenter param when no track carries a fermenter device', () => {
        deps.getAllTracks.mockReturnValue([baseTrack]);
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [{ ...baseMapping, targetType: 'fermenterGlobalParam', paramId: 'mix' }],
            isLearning: false,
            learningTarget: null,
        });

        handleMidiMessage(0, 7, 127);

        expect(deps.setFermenterMappedParam).not.toHaveBeenCalled();
    });

    it('records automation only while the transport plays and the track is armed to write', () => {
        const fermenterTrack = makeTrack({
            id: 'track2',
            automationMode: 'write',
            devices: [{ id: 'ferm1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} }],
        });
        deps.getAllTracks.mockReturnValue([fermenterTrack]);
        deps.getTransportIsPlaying.mockReturnValue(true);
        deps.getTransportPlayheadPosition.mockReturnValue(12.5);
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [{ ...baseMapping, targetType: 'fermenterGlobalParam', paramId: 'mix' }],
            isLearning: false,
            learningTarget: null,
        });

        handleMidiMessage(0, 7, 127);

        expect(deps.recordAutomationValue).toHaveBeenCalledWith('track2', 'ferm1:mix', 1, 12.5);
    });

    it('skips automation recording for a track left in read mode even while playing', () => {
        const fermenterTrack = makeTrack({
            id: 'track2',
            automationMode: 'read',
            devices: [{ id: 'ferm1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} }],
        });
        deps.getAllTracks.mockReturnValue([fermenterTrack]);
        deps.getTransportIsPlaying.mockReturnValue(true);
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [{ ...baseMapping, targetType: 'fermenterGlobalParam', paramId: 'mix' }],
            isLearning: false,
            learningTarget: null,
        });

        handleMidiMessage(0, 7, 127);

        expect(deps.recordAutomationValue).not.toHaveBeenCalled();
    });

    it('records automation only for the fermenter track whose live parameter actually moved (F-1)', () => {
        // Two tracks each carry a fermenter and are both armed to write. Only
        // the first fermenter found (the one `setFermenterMappedParam` actually
        // targets) may receive a recorded automation value — a second armed
        // track must not get a value its live parameter never moved to.
        const firstFermenterTrack = makeTrack({
            id: 'track2',
            automationMode: 'write',
            devices: [{ id: 'ferm1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} }],
        });
        const secondFermenterTrack = makeTrack({
            id: 'track3',
            automationMode: 'write',
            devices: [{ id: 'ferm2', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} }],
        });
        deps.getAllTracks.mockReturnValue([firstFermenterTrack, secondFermenterTrack]);
        deps.getTransportIsPlaying.mockReturnValue(true);
        deps.getTransportPlayheadPosition.mockReturnValue(4);
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [{ ...baseMapping, targetType: 'fermenterGlobalParam', paramId: 'mix' }],
            isLearning: false,
            learningTarget: null,
        });

        handleMidiMessage(0, 7, 127);

        expect(deps.setFermenterMappedParam).toHaveBeenCalledWith({ deviceId: 'ferm1', paramId: 'mix', value: 1 });
        expect(deps.recordAutomationValue).toHaveBeenCalledTimes(1);
        expect(deps.recordAutomationValue).toHaveBeenCalledWith('track2', 'ferm1:mix', 1, 4);
    });
});

describe('scaleMidiValue', () => {
    it('maps the 7-bit range endpoints to [min, max] for every mode', () => {
        for (const mode of ['linear', 'log', 'exp'] as const) {
            expect(scaleMidiValue(0, 0, 1, mode)).toBeCloseTo(0);
            expect(scaleMidiValue(127, 0, 1, mode)).toBeCloseTo(1);
        }
    });

    it('defaults to a linear curve when no mode is given', () => {
        // Midpoint CC (~0.5 of range) lands at the linear midpoint.
        expect(scaleMidiValue(64, 0, 1)).toBeCloseTo(64 / 127);
        expect(scaleMidiValue(64, 0, 1, 'linear')).toBeCloseTo(64 / 127);
    });

    it('log mode is the convex audio taper: midpoint sits below the linear midpoint (F-2)', () => {
        const t = 64 / 127;
        // t*t < t for t in (0,1): a "log" (audio-pot) gain taper stays low
        // longer and covers more range near the top, matching how loudness is
        // perceived — the opposite of the pre-fix sqrt(t) body.
        expect(scaleMidiValue(64, 0, 1, 'log')).toBeCloseTo(t * t);
        expect(scaleMidiValue(64, 0, 1, 'log')).toBeLessThan(scaleMidiValue(64, 0, 1, 'linear'));
    });

    it('exp mode is the concave inverse taper: midpoint sits above the linear midpoint (F-2)', () => {
        const t = 64 / 127;
        // sqrt(t) > t for t in (0,1): "exp" is log's inverse, reaching higher
        // faster — fine control stays at the low end instead.
        expect(scaleMidiValue(64, 0, 1, 'exp')).toBeCloseTo(Math.sqrt(t));
        expect(scaleMidiValue(64, 0, 1, 'exp')).toBeGreaterThan(scaleMidiValue(64, 0, 1, 'linear'));
    });

    it('honours an asymmetric range such as pan [-50, 50]', () => {
        expect(scaleMidiValue(0, -50, 50, 'linear')).toBeCloseTo(-50);
        expect(scaleMidiValue(127, -50, 50, 'linear')).toBeCloseTo(50);
        expect(scaleMidiValue(64, -50, 50, 'linear')).toBeCloseTo(-50 + (64 / 127) * 100);
    });

    it('clamps out-of-spec raw values into the target range', () => {
        expect(scaleMidiValue(200, 0, 1, 'linear')).toBeCloseTo(1);
        expect(scaleMidiValue(-5, 0, 1, 'linear')).toBeCloseTo(0);
    });
});

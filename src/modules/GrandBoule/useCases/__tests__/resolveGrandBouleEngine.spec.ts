import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestTrackDevice = {
    id: string;
};

type TestTrack = {
    id: string;
    devices: readonly TestTrackDevice[];
};

type TestGrandBouleControls = {
    ready: boolean;
    noteOn: (midiNote: number, velocity: number) => void;
    noteOff: (midiNote: number, sampleFrame?: number, releaseVelocity?: number) => void;
    noteOnMidi2: (midiNote: number, velocity16bit: number, pitchOffsetQ24: number) => void;
    setParam: (name: string, value: number) => void;
    setSustain: (position: number) => void;
    setUnaCorda: (engaged: boolean) => void;
    setSostenuto: (engaged: boolean) => void;
    setTemperament: (index: number) => void;
    loadAttackClip: (key: number, samples: Float32Array) => void;
    allNotesOff: () => void;
};

type TestStrip = {
    analyserNode: AnalyserNode | null;
    deviceNodes: ReadonlyArray<{
        /**
         * Real device nodes always carry an id (`BuiltinDeviceNode.deviceId` is
         * required). The fixture used to omit it, which let a resolver that
         * ignored `input.deviceId` look correct here.
         */
        deviceId: string;
        grandBouleControls?: TestGrandBouleControls;
    }>;
};

const mocks = vi.hoisted(() => ({
    ensureTrackStrip: vi.fn<(trackId: string) => TestStrip>(),
    getAllTracks: vi.fn<() => TestTrack[]>(),
    getAudioSampleRate: vi.fn<() => number>(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: mocks.getAllTracks,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    ensureTrackStrip: mocks.ensureTrackStrip,
    getAudioSampleRate: mocks.getAudioSampleRate,
}));

import { resolveGrandBouleEngine } from '../resolveGrandBouleEngine';

function createTrack(input: { trackId: string; deviceId: string }): TestTrack {
    return {
        id: input.trackId,
        devices: [{ id: input.deviceId }],
    };
}

function createControls(input?: { ready?: boolean }): TestGrandBouleControls {
    return {
        ready: input?.ready ?? true,
        noteOn: vi.fn<(midiNote: number, velocity: number) => void>(),
        noteOff: vi.fn<(midiNote: number, sampleFrame?: number, releaseVelocity?: number) => void>(),
        noteOnMidi2: vi.fn<(midiNote: number, velocity16bit: number, pitchOffsetQ24: number) => void>(),
        setParam: vi.fn<(name: string, value: number) => void>(),
        setSustain: vi.fn<(position: number) => void>(),
        setUnaCorda: vi.fn<(engaged: boolean) => void>(),
        setSostenuto: vi.fn<(engaged: boolean) => void>(),
        setTemperament: vi.fn<(index: number) => void>(),
        loadAttackClip: vi.fn<(key: number, samples: Float32Array) => void>(),
        allNotesOff: vi.fn<() => void>(),
    };
}

type TestStripNode = { deviceId: string; controls?: TestGrandBouleControls };

function createStrip(input: { nodes: ReadonlyArray<TestStripNode> }): TestStrip {
    return {
        analyserNode: null,
        deviceNodes: input.nodes.map((node) => ({
            deviceId: node.deviceId,
            grandBouleControls: node.controls,
        })),
    };
}

describe('resolveGrandBouleEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ensureTrackStrip.mockReturnValue(createStrip({ nodes: [] }));
        mocks.getAllTracks.mockReturnValue([]);
        mocks.getAudioSampleRate.mockReturnValue(48000);
    });

    it('should resolve ready GrandBoule controls from supplied tracks without reading Arrangement state', () => {
        const inactiveControls = createControls({ ready: false });
        const readyControls = createControls();
        const samples = new Float32Array([0.25, -0.25]);
        mocks.ensureTrackStrip.mockReturnValue(
            createStrip({
                nodes: [
                    { deviceId: 'other-grand-boule', controls: inactiveControls },
                    { deviceId: 'grand-boule-device', controls: readyControls },
                ],
            })
        );
        mocks.getAudioSampleRate.mockReturnValue(96000);

        const engine = resolveGrandBouleEngine({
            deviceId: 'grand-boule-device',
            tracks: [createTrack({ trackId: 'track-live', deviceId: 'grand-boule-device' })],
        });

        expect(mocks.getAllTracks).not.toHaveBeenCalled();
        expect(mocks.ensureTrackStrip).toHaveBeenCalledWith('track-live');
        expect(engine.isReady()).toBe(true);

        engine.noteOn({ midiNote: 60, velocity: 0.75 });
        engine.noteOff({ midiNote: 61 });
        engine.noteOnMidi2({ midiNote: 62, velocity16bit: 32000, pitchOffsetQ24: 128 });
        engine.setParam({ name: 'master_gain', value: 0.5 });
        engine.setSustain({ position: 0.9 });
        engine.setUnaCorda({ engaged: true });
        engine.setSostenuto({ engaged: true });
        engine.setTemperament({ index: 3 });
        engine.loadAttackClip({ key: 40, samples });
        engine.allNotesOff();

        expect(inactiveControls.noteOn).not.toHaveBeenCalled();
        expect(readyControls.noteOn).toHaveBeenCalledWith(60, 0.75);
        expect(readyControls.noteOff).toHaveBeenCalledWith(61);
        expect(readyControls.noteOnMidi2).toHaveBeenCalledWith(62, 32000, 128);
        expect(readyControls.setParam).toHaveBeenCalledWith('master_gain', 0.5);
        expect(readyControls.setSustain).toHaveBeenCalledWith(0.9);
        expect(readyControls.setUnaCorda).toHaveBeenCalledWith(true);
        expect(readyControls.setSostenuto).toHaveBeenCalledWith(true);
        expect(readyControls.setTemperament).toHaveBeenCalledWith(3);
        expect(readyControls.loadAttackClip).toHaveBeenCalledWith(40, samples);
        expect(readyControls.allNotesOff).toHaveBeenCalledTimes(1);
        expect(engine.sampleRate()).toBe(96000);
    });

    it('should fall back to getAllTracks when tracks are omitted', () => {
        const readyControls = createControls();
        mocks.getAllTracks.mockReturnValue([createTrack({ trackId: 'track-fallback', deviceId: 'fallback-device' })]);
        mocks.ensureTrackStrip.mockReturnValue(
            createStrip({ nodes: [{ deviceId: 'fallback-device', controls: readyControls }] })
        );

        const engine = resolveGrandBouleEngine({ deviceId: 'fallback-device' });

        expect(mocks.getAllTracks).toHaveBeenCalledTimes(1);
        expect(mocks.ensureTrackStrip).toHaveBeenCalledWith('track-fallback');
        expect(engine.isReady()).toBe(true);
    });

    it('should return a disconnected handle when no track owns the device', () => {
        mocks.getAllTracks.mockReturnValue([createTrack({ trackId: 'track-other', deviceId: 'other-device' })]);

        const engine = resolveGrandBouleEngine({ deviceId: 'missing-device' });

        expect(mocks.ensureTrackStrip).not.toHaveBeenCalled();
        expect(engine.isReady()).toBe(false);
        expect(engine.getAnalyserNode()).toBeNull();
        expect(engine.sampleRate()).toBe(44100);
    });

    it('should return a disconnected handle when the matching strip has no ready GrandBoule controls', () => {
        const inactiveControls = createControls({ ready: false });
        mocks.ensureTrackStrip.mockReturnValue(
            createStrip({
                nodes: [{ deviceId: 'plain-device' }, { deviceId: 'grand-boule-device', controls: inactiveControls }],
            })
        );

        const engine = resolveGrandBouleEngine({
            deviceId: 'grand-boule-device',
            tracks: [createTrack({ trackId: 'track-live', deviceId: 'grand-boule-device' })],
        });

        engine.noteOn({ midiNote: 64, velocity: 0.5 });

        expect(engine.isReady()).toBe(false);
        expect(inactiveControls.noteOn).not.toHaveBeenCalled();
    });

    it('should address the requested piano when a track hosts two ready GrandBoules', () => {
        // The resolver had `input.deviceId` in scope — it uses it to find the
        // owning track — and then discarded it when picking the device node, so
        // the entire returned handle (noteOn, setParam, setSustain,
        // loadAttackClip) addressed whichever piano came first in the chain.
        const firstControls = createControls();
        const addressedControls = createControls();
        const samples = new Float32Array([0.5, -0.5]);
        mocks.ensureTrackStrip.mockReturnValue(
            createStrip({
                nodes: [
                    { deviceId: 'grand-boule-first', controls: firstControls },
                    { deviceId: 'grand-boule-second', controls: addressedControls },
                ],
            })
        );

        const engine = resolveGrandBouleEngine({
            deviceId: 'grand-boule-second',
            tracks: [
                {
                    id: 'track-live',
                    devices: [{ id: 'grand-boule-first' }, { id: 'grand-boule-second' }],
                },
            ],
        });

        engine.noteOn({ midiNote: 60, velocity: 0.75 });
        engine.setParam({ name: 'master_gain', value: 0.25 });
        engine.setSustain({ position: 1 });
        engine.loadAttackClip({ key: 40, samples });

        expect(addressedControls.noteOn).toHaveBeenCalledWith(60, 0.75);
        expect(addressedControls.setParam).toHaveBeenCalledWith('master_gain', 0.25);
        expect(addressedControls.setSustain).toHaveBeenCalledWith(1);
        expect(addressedControls.loadAttackClip).toHaveBeenCalledWith(40, samples);
        expect(firstControls.noteOn).not.toHaveBeenCalled();
        expect(firstControls.setParam).not.toHaveBeenCalled();
        expect(firstControls.setSustain).not.toHaveBeenCalled();
        expect(firstControls.loadAttackClip).not.toHaveBeenCalled();
    });
});

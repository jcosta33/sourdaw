import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    sendNativeLiveMidiControl: vi.fn(async () => true),
    writeNativeBuiltinParameters: vi.fn(),
    controls: {
        ready: true,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        noteOnMidi2: vi.fn(),
        setParam: vi.fn(),
        setSustain: vi.fn(),
        setUnaCorda: vi.fn(),
        setSostenuto: vi.fn(),
        setTemperament: vi.fn(),
        allNotesOff: vi.fn(),
    },
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: () => [{ id: 'track-1', devices: [{ id: 'grand-1' }] }],
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    ensureTrackStrip: () => ({
        deviceNodes: [{ deviceId: 'grand-1', grandBouleControls: mocks.controls }],
        analyserNode: null,
    }),
    getAudioSampleRate: () => 48_000,
    sendNativeLiveMidiControl: mocks.sendNativeLiveMidiControl,
    writeNativeBuiltinParameters: mocks.writeNativeBuiltinParameters,
}));
vi.mock('../../repositories/grandBouleEngineHandle', () => ({
    createDisconnectedGrandBouleEngineHandle: vi.fn(() => ({ setCalibration: vi.fn() })),
}));

import { resolveGrandBouleEngine } from '../resolveGrandBouleEngine';

describe('resolveGrandBouleEngine', () => {
    beforeEach(() => {
        mocks.sendNativeLiveMidiControl.mockClear();
        mocks.writeNativeBuiltinParameters.mockClear();
        mocks.controls.setParam.mockClear();
        mocks.controls.setSustain.mockClear();
        mocks.controls.setSostenuto.mockClear();
        mocks.controls.setUnaCorda.mockClear();
    });

    it('resolves the addressed ready controls without mutating project or session state', () => {
        const engine = resolveGrandBouleEngine({ deviceId: 'grand-1' });

        engine.setParam({ name: 'tone_color', value: 0.2 });
        expect(mocks.controls.setParam).toHaveBeenCalledWith('tone_color', 0.2);
    });

    it('sends a panel damper movement to the engine body as well as the Web Audio node', () => {
        // The panel's pedals are the same foot as a physical one, and a
        // native-carried piano hears nothing the engine body is not sent.
        const engine = resolveGrandBouleEngine({ deviceId: 'grand-1' });

        engine.setSustain({ position: 1 });

        expect(mocks.controls.setSustain).toHaveBeenCalledWith(1);
        // The raw 7-bit value for the resolved track and device: the engine's
        // body divides CC 64 by full scale itself.
        expect(mocks.sendNativeLiveMidiControl).toHaveBeenCalledTimes(1);
        expect(mocks.sendNativeLiveMidiControl).toHaveBeenCalledWith({
            trackId: 'track-1',
            deviceId: 'grand-1',
            controller: 64,
            value: 127,
            channel: 0,
        });
    });

    it.each([
        { position: 0.5, wire: 64 },
        { position: 0.3, wire: 38 },
    ])('quantizes a damper position of $position once for both carriers', (subject) => {
        // The body divides CC64 by full scale, so the web node has to take the
        // wire value back over full scale: at the panel's reachable 0.50 step
        // the raw position sat on the wrong side of the half-travel threshold
        // both carriers engage above, so the native piano sustained and the
        // web one did not.
        const engine = resolveGrandBouleEngine({ deviceId: 'grand-1' });

        engine.setSustain({ position: subject.position });

        expect(mocks.controls.setSustain).toHaveBeenCalledWith(subject.wire / 127);
        expect(mocks.sendNativeLiveMidiControl).toHaveBeenCalledWith({
            trackId: 'track-1',
            deviceId: 'grand-1',
            controller: 64,
            value: subject.wire,
            channel: 0,
        });
    });

    it.each([
        { pedal: 'sostenuto' as const, controller: 66, setter: mocks.controls.setSostenuto },
        { pedal: 'una corda' as const, controller: 67, setter: mocks.controls.setUnaCorda },
    ])('sends a panel $pedal switch to both bodies, engaged and released', (subject) => {
        const engine = resolveGrandBouleEngine({ deviceId: 'grand-1' });
        const move = subject.controller === 66 ? engine.setSostenuto : engine.setUnaCorda;

        move({ engaged: true });
        move({ engaged: false });

        expect(subject.setter.mock.calls).toEqual([[true], [false]]);
        expect(mocks.sendNativeLiveMidiControl.mock.calls).toEqual([
            [{ trackId: 'track-1', deviceId: 'grand-1', controller: subject.controller, value: 127, channel: 0 }],
            [{ trackId: 'track-1', deviceId: 'grand-1', controller: subject.controller, value: 0, channel: 0 }],
        ]);
    });

    it('mirrors a calibration write onto both the Web Audio node and the native session', () => {
        const engine = resolveGrandBouleEngine({ deviceId: 'grand-1' });

        engine.setCalibration({ sustainThreshold: 0.6, ccSmoothingMs: 40 });

        expect(mocks.controls.setParam).toHaveBeenCalledWith('sustain_threshold', 0.6);
        expect(mocks.controls.setParam).toHaveBeenCalledWith('cc_smoothing_ms', 40);
        expect(mocks.writeNativeBuiltinParameters).toHaveBeenCalledExactlyOnceWith('track-1', 'grand-1', {
            sustain_threshold: 0.6,
            cc_smoothing_ms: 40,
        });
    });

    it('writes no calibration natively for a device on no track', () => {
        // A device the resolver cannot find on any track never reaches the
        // ready-controls branch that constructs the native write, so the
        // disconnected handle's own no-op is what a caller gets instead.
        const engine = resolveGrandBouleEngine({ deviceId: 'no-such-device' });

        engine.setCalibration({ sustainThreshold: 0.6, ccSmoothingMs: 40 });

        expect(mocks.writeNativeBuiltinParameters).not.toHaveBeenCalled();
    });
});

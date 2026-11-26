import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { clampDeviceParamWrite, trackStore, type Device, type Track } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { isDeviceCarriedByNativeSession } from '../../livePlayback/isDeviceCarriedByNativeSession';
import { sendNativeDeviceParameters } from '../../livePlayback/sendNativeDeviceParameters';
import { updateDeviceParam, updateDeviceParameters } from '../updateDeviceParam';

registerDeviceEnginePorts();

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        updateDeviceParam: vi.fn(),
    },
}));

vi.mock('../../livePlayback/isDeviceCarriedByNativeSession', () => ({
    isDeviceCarriedByNativeSession: vi.fn(() => false),
}));

vi.mock('../../livePlayback/sendNativeDeviceParameters', () => ({
    sendNativeDeviceParameters: vi.fn(async () => true),
}));

// The law itself (descriptor lookup, min/max, pass-through when nothing is
// declared) is covered against real product descriptors in
// `Arrangement/stores/__tests__/clampDeviceParamWrite.spec.ts`. What is under
// test here is that this use case — the one door twenty call sites reach the
// DSP through — actually routes its value through that law instead of past it.
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...mod,
        clampDeviceParamWrite: vi.fn(({ value }: { value: number }) => value),
    };
});

function createDevice(overrides: Partial<Device> & { id: string }): Device {
    return { name: overrides.id, type: 'knead', bypassed: false, parameterValues: {}, ...overrides };
}

/** Puts one device on one track, which is where the write path reads its body from. */
function projectHolding(device: Device): void {
    trackStore.set({
        tracks: [{ id: 't1', name: 'Lead', devices: [device] } as unknown as Track],
        selectedTrackId: null,
        ghostClips: [],
    });
}

beforeEach(() => {
    vi.mocked(audioEngine.updateDeviceParam).mockReset();
    vi.mocked(sendNativeDeviceParameters).mockClear();
    vi.mocked(isDeviceCarriedByNativeSession).mockReset();
    vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(false);
    vi.mocked(clampDeviceParamWrite).mockReset();
    vi.mocked(clampDeviceParamWrite).mockImplementation(({ value }) => value);
});

afterEach(() => {
    trackStore.set(null);
});

describe('updateDeviceParam', () => {
    beforeEach(() => {
        projectHolding(createDevice({ id: 'd1', type: 'fermenter' }));
    });

    it('should forward to the audio engine', () => {
        updateDeviceParam('t1', 'd1', 'gain', 0.75);

        expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.75);
    });

    it('asks the declared-range law about the write it is making', () => {
        updateDeviceParam('t1', 'd1', 'mix', 4.2);

        expect(clampDeviceParamWrite).toHaveBeenCalledWith({ deviceId: 'd1', paramId: 'mix', value: 4.2 });
    });

    it('sends the DSP the value the law allowed, not the value the caller asked for', () => {
        vi.mocked(clampDeviceParamWrite).mockReturnValue(1);

        updateDeviceParam('t1', 'd1', 'mix', 4.2);

        // Clamping only the store twin (`persistDeviceParam`) would leave the
        // stored row inside the declared range and the audible value outside
        // it, so the two disagree about what the parameter is.
        expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'mix', 1);
        expect(audioEngine.updateDeviceParam).not.toHaveBeenCalledWith('t1', 'd1', 'mix', 4.2);
    });

    // A carried strip's Web Audio node is gated out of the mix while rolling,
    // but it is the fallback carrier the moment Stop reopens the gate, so it
    // has to hold the current value too — the native send is additive, in the
    // name the instrument answers to, and the engine refuses a key it cannot
    // resolve and takes the whole batch with it.
    it('writes the Web Audio node and the carried native body', () => {
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(true);

        updateDeviceParam('t1', 'd1', 'oscEngine', 0.75);

        expect(audioEngine.updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'oscEngine', 0.75);
        expect(sendNativeDeviceParameters).toHaveBeenCalledTimes(1);
        expect(sendNativeDeviceParameters).toHaveBeenCalledWith({
            trackId: 't1',
            deviceId: 'd1',
            values: { engine: 0.75 },
        });
    });

    it('sends the carried native body the value the law allowed, not the value the caller asked for', () => {
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(true);
        vi.mocked(clampDeviceParamWrite).mockReturnValue(1);

        updateDeviceParam('t1', 'd1', 'oscEngine', 4.2);

        expect(audioEngine.updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'oscEngine', 1);
        expect(sendNativeDeviceParameters).toHaveBeenCalledTimes(1);
        expect(sendNativeDeviceParameters).toHaveBeenCalledWith({
            trackId: 't1',
            deviceId: 'd1',
            values: { engine: 1 },
        });
    });

    // A built-in whose ids are already the engine's names still goes over the
    // engine when the session carries it — the routing is about the carrier,
    // not about which body happens to need a translation — and the Web Audio
    // node still gets the same write for when the carry ends.
    it('writes the Web Audio node and the carried knead body under the name the project stores', () => {
        projectHolding(createDevice({ id: 'd1', type: 'knead' }));
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(true);

        updateDeviceParam('t1', 'd1', 'shift_semitones', 3);

        expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'shift_semitones', 3);
        expect(sendNativeDeviceParameters).toHaveBeenCalledWith({
            trackId: 't1',
            deviceId: 'd1',
            values: { shift_semitones: 3 },
        });
    });

    // A device the session is not carrying is still Web Audio's to sound, and
    // a write taken away from it is a control the musician cannot hear move.
    it('keeps the web write for a built-in no native session is carrying', () => {
        updateDeviceParam('t1', 'd1', 'oscEngine', 0.75);

        expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'oscEngine', 0.75);
        expect(sendNativeDeviceParameters).not.toHaveBeenCalled();
    });

    // A hosted plugin's parameters are the plugin's own, addressed over the
    // plugin host's control path; `set-device-parameters` names a built-in
    // only, and the engine refuses one aimed at a plugin.
    it('keeps the web write for a carried device the engine builds no built-in body for', () => {
        projectHolding(
            createDevice({
                id: 'd1',
                name: 'Pro-Q',
                type: 'external-plugin',
                externalPluginId: 'clap:com.example.eq',
                externalInstanceId: 'inst-1',
            })
        );
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(true);

        updateDeviceParam('t1', 'd1', 'gain', 0.75);

        expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.75);
        expect(sendNativeDeviceParameters).not.toHaveBeenCalled();
    });
});

describe('updateDeviceParameters', () => {
    beforeEach(() => {
        projectHolding(createDevice({ id: 'd1', type: 'crust' }));
    });

    it('writes clamped parameters in their supplied order with no native send for an uncarried Crust', () => {
        vi.mocked(clampDeviceParamWrite).mockReturnValueOnce(2).mockReturnValueOnce(7);

        updateDeviceParameters('t1', 'd1', [
            ['style', 19],
            ['algorithm', 25],
        ]);

        expect(vi.mocked(clampDeviceParamWrite).mock.calls).toEqual([
            [{ deviceId: 'd1', paramId: 'style', value: 19 }],
            [{ deviceId: 'd1', paramId: 'algorithm', value: 25 }],
        ]);
        expect(vi.mocked(audioEngine.updateDeviceParam).mock.calls).toEqual([
            ['t1', 'd1', 'style', 2],
            ['t1', 'd1', 'algorithm', 7],
        ]);
        expect(sendNativeDeviceParameters).not.toHaveBeenCalled();
    });

    it('sends one carried Crust command with all the clamped values under their native names', () => {
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(true);
        vi.mocked(clampDeviceParamWrite).mockReturnValueOnce(1).mockReturnValueOnce(4).mockReturnValueOnce(1);

        updateDeviceParameters('t1', 'd1', [
            ['style', 1],
            ['algorithm', 4],
            ['attackAuto', 8],
        ]);

        expect(vi.mocked(audioEngine.updateDeviceParam).mock.calls).toEqual([
            ['t1', 'd1', 'style', 1],
            ['t1', 'd1', 'algorithm', 4],
            ['t1', 'd1', 'attackAuto', 1],
        ]);
        expect(sendNativeDeviceParameters).toHaveBeenCalledExactlyOnceWith({
            trackId: 't1',
            deviceId: 'd1',
            values: { style: 1, algorithm: 4, attack_auto: 1 },
        });
    });

    it('propagates a Web Audio failure without sending an incomplete native command', () => {
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(true);
        const failure = new Error('Web Audio update failed');
        vi.mocked(audioEngine.updateDeviceParam)
            .mockImplementationOnce(() => {})
            .mockImplementationOnce(() => {
                throw failure;
            });

        expect(() =>
            updateDeviceParameters('t1', 'd1', [
                ['style', 1],
                ['algorithm', 4],
                ['attackAuto', 1],
            ])
        ).toThrow(failure);
        expect(vi.mocked(audioEngine.updateDeviceParam).mock.calls).toEqual([
            ['t1', 'd1', 'style', 1],
            ['t1', 'd1', 'algorithm', 4],
        ]);
        expect(sendNativeDeviceParameters).not.toHaveBeenCalled();
    });
});

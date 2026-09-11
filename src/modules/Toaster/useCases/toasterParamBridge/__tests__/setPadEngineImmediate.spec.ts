import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

const { mockResolveDeviceTarget, mockGetTrackStrip, mockWriteNativeBuiltinParameters } = vi.hoisted(() => ({
    mockResolveDeviceTarget: vi.fn<(deviceId: string) => DeviceWriteTargetResolution>(),
    mockGetTrackStrip: vi.fn(),
    mockWriteNativeBuiltinParameters:
        vi.fn<(trackId: string, deviceId: string, values: Readonly<Record<string, number>>) => void>(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: mockResolveDeviceTarget,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackStrip: mockGetTrackStrip,
    writeNativeBuiltinParameters: mockWriteNativeBuiltinParameters,
}));

import { setPadEngineImmediate } from '../setPadEngineImmediate';

describe('setPadEngineImmediate', () => {
    const setPadParam = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockResolveDeviceTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'dev-1',
        });
        // Real device nodes always carry an id (`BuiltinDeviceNode.deviceId` is
        // required). Omitting it here is what let a selector that ignored
        // `deviceId` look correct against this fixture.
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [{ deviceId: 'dev-1', toasterControls: { ready: true, setPadParam } }],
        });
    });

    it('is a function', () => {
        expect(typeof setPadEngineImmediate).toBe('function');
    });

    it('sends the engine change to the addressed Toaster, not the first one on the track', () => {
        const otherSetPadParam = vi.fn();
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [
                { deviceId: 'dev-other', toasterControls: { ready: true, setPadParam: otherSetPadParam } },
                { deviceId: 'dev-1', toasterControls: { ready: true, setPadParam } },
            ],
        });

        setPadEngineImmediate('dev-1', 2, 4);

        expect(setPadParam).toHaveBeenCalledWith(2, 'engine_type', 4);
        expect(otherSetPadParam).not.toHaveBeenCalled();
    });

    it('skips a Toaster that is still loading rather than writing into its placeholder', () => {
        // Unlike the kit path, a placeholder's `setPadParam` is an empty
        // function that buffers nothing — the write is dropped, and the old
        // `ready !== undefined` predicate preferred the placeholder over a real
        // loaded device further down the chain.
        const loadingSetPadParam = vi.fn();
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [{ deviceId: 'dev-1', toasterControls: { ready: false, setPadParam: loadingSetPadParam } }],
        });

        setPadEngineImmediate('dev-1', 2, 4);

        expect(loadingSetPadParam).not.toHaveBeenCalled();
    });

    it('sends an eligible engine change immediately', () => {
        setPadEngineImmediate('dev-1', 2, 4);

        expect(mockGetTrackStrip).toHaveBeenCalledWith('track-1');
        expect(setPadParam).toHaveBeenCalledWith(2, 'engine_type', 4);
    });

    /**
     * A pad edit never reaches `updateDeviceParam` — Toaster's pads are not
     * `parameterValues` entries — so without this send a natively carried
     * Toaster held the kit its topology splice shipped and ignored a sound
     * lock's engine swap.
     */
    it('also sends the engine change to the native session, with the index folded into the name', () => {
        setPadEngineImmediate('dev-1', 3, 4);

        expect(mockWriteNativeBuiltinParameters).toHaveBeenCalledExactlyOnceWith('track-1', 'dev-1', {
            pad3_engine_type: 4,
        });
    });

    it.each(['missing', 'ineligible'] as const)('rejects a %s owner before runtime effects', (status) => {
        mockResolveDeviceTarget.mockReturnValue({ status });

        setPadEngineImmediate('dev-1', 2, 4);

        expect(mockGetTrackStrip).not.toHaveBeenCalled();
        expect(setPadParam).not.toHaveBeenCalled();
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

const { mockResolveDeviceTarget, mockGetTrackStrip } = vi.hoisted(() => ({
    mockResolveDeviceTarget: vi.fn<(deviceId: string) => DeviceWriteTargetResolution>(),
    mockGetTrackStrip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: mockResolveDeviceTarget,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackStrip: mockGetTrackStrip,
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
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [{ toasterControls: { ready: true, setPadParam } }],
        });
    });

    it('is a function', () => {
        expect(typeof setPadEngineImmediate).toBe('function');
    });

    it('sends an eligible engine change immediately', () => {
        setPadEngineImmediate('dev-1', 2, 4);

        expect(mockGetTrackStrip).toHaveBeenCalledWith('track-1');
        expect(setPadParam).toHaveBeenCalledWith(2, 'engine_type', 4);
    });

    it.each(['missing', 'ineligible'] as const)('rejects a %s owner before runtime effects', (status) => {
        mockResolveDeviceTarget.mockReturnValue({ status });

        setPadEngineImmediate('dev-1', 2, 4);

        expect(mockGetTrackStrip).not.toHaveBeenCalled();
        expect(setPadParam).not.toHaveBeenCalled();
    });
});

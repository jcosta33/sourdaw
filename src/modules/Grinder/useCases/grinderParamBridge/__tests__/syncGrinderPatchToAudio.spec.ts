import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, migrateGrinderPatch, type GrinderPatch } from '../../../models/GrinderPatch';
import { syncGrinderPatchToAudio } from '../syncGrinderPatchToAudio';

vi.mock('#/modules/Arrangement/stores', () => ({
    persistDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    updateDevicePatch: vi.fn(),
}));

describe('syncGrinderPatchToAudio', () => {
    const update_device_param = vi.fn();
    const persist_device_param = vi.fn();
    const update_device_patch = vi.fn();
    const ref = { trackId: 'track-1', deviceId: 'device-1' };

    function run(patch: GrinderPatch): void {
        syncGrinderPatchToAudio({
            patch,
            ref,
            update_device_param,
            persist_device_param,
            update_device_patch,
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should send the shared pre-compressor defaults when no compressor pedal exists', () => {
        run(migrateGrinderPatch({ ...DEFAULT_PATCH, prePedals: [] }));

        // Single source of truth: the worklet receives -24/3/16/220, matching the panel,
        // never the previously-divergent -20/4/10/200.
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorThreshold', -24);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorRatio', 3);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorAttack', 16);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorRelease', 220);
        expect(update_device_param).not.toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorThreshold', -20);
    });

    it('should forward an existing compressor pedal threshold instead of the default', () => {
        run(
            migrateGrinderPatch({
                ...DEFAULT_PATCH,
                prePedals: [
                    {
                        id: 'comp1',
                        type: 'compressor',
                        enabled: true,
                        params: { threshold: -12, ratio: 6, attack: 5, release: 90 },
                    },
                ],
            })
        );

        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorEnabled', 1);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorThreshold', -12);
        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'preCompressorRatio', 6);
    });

    it('should skip enum keys that resolve to no audio index without sending a non-finite value', () => {
        // routingMode 'serial' is index 0 (finite); an unknown enum value resolves to null
        // and must be skipped. The guard relies solely on the null result, so a finite 0
        // index still reaches the device.
        run(migrateGrinderPatch({ ...DEFAULT_PATCH, routingMode: 'serial' }));

        expect(update_device_param).toHaveBeenCalledWith('track-1', 'device-1', 'routingMode', 0);

        update_device_param.mockClear();

        run(migrateGrinderPatch({ ...DEFAULT_PATCH, routingMode: 'not-a-real-mode' as GrinderPatch['routingMode'] }));

        const routing_calls = update_device_param.mock.calls.filter((call) => call[2] === 'routingMode');
        expect(routing_calls).toHaveLength(0);
    });
});

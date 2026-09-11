import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

import { bridges } from '../helpers';
import { syncDynBands } from '../syncDynBands';
import { syncEqBands } from '../syncEqBands';
import { syncExciter } from '../syncExciter';
import { syncImager } from '../syncImager';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    updateDevicePatch: vi.fn(),
}));

// These four sync* functions send every band they walk through the device door,
// so a natively carried Proof takes a preset load or a section resync as well
// as the web twin does. Nothing here consults the worklet bridge registry: a
// device the native session carries never registers one.
describe('proofParamBridge sync* device writes', () => {
    beforeEach(() => {
        bridges.clear();
        vi.clearAllMocks();
        vi.mocked(resolveEligibleDeviceWriteTarget).mockImplementation((deviceId) => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        }));
    });

    it('sends EQ band parameters with no bridge registered for the device', () => {
        syncEqBands('dev-1');

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'dev-1', 'eq_band0_freq', expect.any(Number));
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'dev-1', 'eq_band7_q', expect.any(Number));
    });

    it('sends dynamics crossovers and band parameters with no bridge registered', () => {
        syncDynBands('dev-1');

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'dev-1', 'dyn_xover0', expect.any(Number));
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'dev-1', 'dyn_band0_threshold', expect.any(Number));
    });

    it('sends exciter band parameters with no bridge registered', () => {
        syncExciter('dev-1');

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'dev-1', 'exc_band0_drive', expect.any(Number));
    });

    it('sends imager band widths and mono-bass params', () => {
        syncImager('dev-1');

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'dev-1', 'img_width0', expect.any(Number));
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'dev-1', 'img_auto_mono_bass', expect.any(Number));
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'dev-1', 'img_mono_bass_freq', expect.any(Number));
    });

    it.each(['missing', 'ineligible'] as const)('writes nothing for a %s target', (status) => {
        vi.mocked(resolveEligibleDeviceWriteTarget).mockReturnValue({ status });

        syncEqBands('dev-1');
        syncDynBands('dev-1');
        syncExciter('dev-1');
        syncImager('dev-1');

        expect(updateDeviceParam).not.toHaveBeenCalled();
    });
});

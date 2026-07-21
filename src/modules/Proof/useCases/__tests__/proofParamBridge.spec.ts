import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { setProofParam } from '../proofParamBridge/setProofParam';

const persistDeviceParam = vi.fn<typeof import('#/modules/Arrangement/stores').persistDeviceParam>();
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    persistDeviceParam: (...args: Parameters<typeof import('#/modules/Arrangement/stores').persistDeviceParam>) =>
        persistDeviceParam(...args),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));

describe('setProofParam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(resolveEligibleDeviceWriteTarget).mockImplementation((deviceId) => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        }));
    });

    it('persists the parameter value', () => {
        setProofParam({ deviceId: 'device-1', name: 'gain', value: 0.5 });

        expect(persistDeviceParam).toHaveBeenCalledWith('device-1', 'gain', 0.5);
    });
});

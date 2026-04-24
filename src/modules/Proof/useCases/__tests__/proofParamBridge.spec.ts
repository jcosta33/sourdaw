import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setProofParam } from '../proofParamBridge/setProofParam';

const persistDeviceParam = vi.fn();
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    persistDeviceParam: (...args: any[]) => persistDeviceParam(...args),
}));

describe('setProofParam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('persists the parameter value', () => {
        setProofParam('device-1', 'gain', 0.5);

        expect(persistDeviceParam).toHaveBeenCalledWith('device-1', 'gain', 0.5);
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setProofParam } from '../proofParamBridge/setProofParam';

const persistDeviceParam = vi.fn<typeof import('#/modules/Arrangement/useCases').persistDeviceParam>();
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    persistDeviceParam: (...args: Parameters<typeof import('#/modules/Arrangement/useCases').persistDeviceParam>) =>
        persistDeviceParam(...args),
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

import { beforeEach, describe, expect, it } from 'vitest';

import { clearCloudProviderConfig } from '../clearCloudProviderConfig';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { unregisterCloudStreamController } from '../unregisterCloudStreamController';

describe('unregisterCloudStreamController', () => {
    beforeEach(async () => {
        await clearCloudProviderConfig();
    });

    it('should prevent a settled stream controller from being aborted on revocation', async () => {
        const controller = registerCloudStreamController(new AbortController());

        unregisterCloudStreamController(controller);
        await clearCloudProviderConfig();

        expect(controller.signal.aborted).toBe(false);
    });
});

import { beforeEach, describe, expect, it } from 'vitest';

import { clearCloudProviderConfig } from '../clearCloudProviderConfig';
import { registerCloudStreamController } from '../registerCloudStreamController';

describe('registerCloudStreamController', () => {
    beforeEach(async () => {
        await clearCloudProviderConfig();
    });

    it('should return and retain the registered controller until revocation', async () => {
        const controller = new AbortController();

        expect(registerCloudStreamController(controller)).toBe(controller);
        await clearCloudProviderConfig();
        expect(controller.signal.aborted).toBe(true);
    });
});

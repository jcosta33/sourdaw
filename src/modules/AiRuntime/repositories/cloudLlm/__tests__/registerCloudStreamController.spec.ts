import { beforeEach, describe, expect, it } from 'vitest';

import { clearCloudApiKey } from '../clearCloudApiKey';
import { registerCloudStreamController } from '../registerCloudStreamController';

describe('registerCloudStreamController', () => {
    beforeEach(() => {
        clearCloudApiKey();
    });

    it('should return and retain the registered controller until revocation', () => {
        const controller = new AbortController();

        expect(registerCloudStreamController(controller)).toBe(controller);
        clearCloudApiKey();
        expect(controller.signal.aborted).toBe(true);
    });
});

import { beforeEach, describe, expect, it } from 'vitest';

import { clearCloudApiKey } from '../clearCloudApiKey';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { unregisterCloudStreamController } from '../unregisterCloudStreamController';

describe('unregisterCloudStreamController', () => {
    beforeEach(() => {
        clearCloudApiKey();
    });

    it('should prevent a settled stream controller from being aborted on revocation', () => {
        const controller = registerCloudStreamController(new AbortController());

        unregisterCloudStreamController(controller);
        clearCloudApiKey();

        expect(controller.signal.aborted).toBe(false);
    });
});

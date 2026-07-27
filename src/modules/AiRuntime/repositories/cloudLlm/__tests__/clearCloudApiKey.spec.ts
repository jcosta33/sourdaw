import { beforeEach, describe, expect, it } from 'vitest';

import { hostedLlmProviderStatusStore } from '../../../stores/hostedLlmProviderStatusStore';
import { clearCloudApiKey } from '../clearCloudApiKey';
import { getCloudClient } from '../getCloudClient';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { setCloudApiKey } from '../setCloudApiKey';

describe('clearCloudApiKey', () => {
    beforeEach(() => {
        clearCloudApiKey();
    });

    it('should clear the client and abort every active stream controller', () => {
        setCloudApiKey('sk-test-key');
        const first = registerCloudStreamController(new AbortController());
        const second = registerCloudStreamController(new AbortController());

        clearCloudApiKey();

        expect(getCloudClient()).toBeNull();
        expect(hostedLlmProviderStatusStore.value).toBeNull();
        expect(first.signal.aborted).toBe(true);
        expect(second.signal.aborted).toBe(true);
    });
});

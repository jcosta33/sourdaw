import { beforeEach, describe, expect, it } from 'vitest';

import { clearCloudApiKey } from '../clearCloudApiKey';
import { getCloudClient } from '../getCloudClient';
import { setCloudApiKey } from '../setCloudApiKey';

describe('getCloudClient', () => {
    beforeEach(() => {
        clearCloudApiKey();
    });

    it('should return null before a cloud API key is configured', () => {
        expect(getCloudClient()).toBeNull();
    });

    it('should return the configured cloud client', () => {
        setCloudApiKey('sk-test-key');

        expect(getCloudClient()).not.toBeNull();
    });
});

import { beforeEach, describe, expect, it } from 'vitest';

import { clearCloudApiKey } from '../clearCloudApiKey';
import { isCloudAvailable } from '../isCloudAvailable';
import { setCloudApiKey } from '../setCloudApiKey';

describe('isCloudAvailable', () => {
    beforeEach(() => {
        clearCloudApiKey();
    });

    it('should return false before a cloud API key is configured', () => {
        expect(isCloudAvailable()).toBe(false);
    });

    it('should return true after a cloud API key is configured', () => {
        setCloudApiKey('sk-test-key');

        expect(isCloudAvailable()).toBe(true);
    });
});

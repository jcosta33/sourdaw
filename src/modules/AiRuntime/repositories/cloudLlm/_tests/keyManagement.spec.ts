import { describe, it, expect, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setCloudApiKey, clearCloudApiKey, isCloudAvailable } from '../keyManagement';
import { type Logger } from '#/helpers/Logger/Logger';

describe('setCloudApiKey', () => {
    beforeEach(() => {
        clearCloudApiKey();
    });

    it('should log when API key is set and mark cloud as available', () => {
        const logger = createMock<Logger>();
        injectDependencies(setCloudApiKey, { logger });

        setCloudApiKey('sk-test-key');

        expect(logger.info).toHaveBeenCalledWith('[Cloud AI] API key set');
        expect(isCloudAvailable()).toBe(true);
    });
});

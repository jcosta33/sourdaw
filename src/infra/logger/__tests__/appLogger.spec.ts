import { afterEach, describe, expect, it, vi } from 'vitest';

describe('appLogger', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('should select production mode when DEV is false', async () => {
        vi.stubEnv('DEV', false);
        vi.resetModules();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const { logger } = await import('../appLogger');
        logger.info('x');
        logger.warn('x');

        expect(console.info).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith('[Sourdaw][WARN]', 'x');
    });

    it('should select development mode for an e2e-mode build that is not DEV', async () => {
        vi.stubEnv('DEV', false);
        vi.stubEnv('MODE', 'e2e');
        vi.resetModules();
        vi.spyOn(console, 'info').mockImplementation(() => {});

        const { logger } = await import('../appLogger');
        logger.info('x');

        expect(console.info).toHaveBeenCalledWith('[DEV][INFO]', 'x');
    });

    it('should select development mode when DEV is true', async () => {
        vi.stubEnv('DEV', true);
        vi.resetModules();
        vi.spyOn(console, 'info').mockImplementation(() => {});

        const { logger } = await import('../appLogger');
        logger.info('x');

        expect(console.info).toHaveBeenCalledWith('[DEV][INFO]', 'x');
    });
});

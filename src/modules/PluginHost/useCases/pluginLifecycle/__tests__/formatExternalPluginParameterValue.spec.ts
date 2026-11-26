import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { formatPluginParameterValue } from '../../../repositories/pluginBridge/formatPluginParameterValue';
import { formatExternalPluginParameterValue } from '../formatExternalPluginParameterValue';

vi.mock('../../../repositories/pluginBridge/formatPluginParameterValue', () => ({
    formatPluginParameterValue: vi.fn(),
}));

describe('formatExternalPluginParameterValue', () => {
    beforeEach(() => {
        vi.mocked(formatPluginParameterValue).mockReset();
    });

    it('answers the plugin text the host returns for the value', async () => {
        vi.mocked(formatPluginParameterValue).mockResolvedValue('1.20 kHz');

        await expect(formatExternalPluginParameterValue('inst-1', 12, 0.43)).resolves.toBe('1.20 kHz');
        expect(formatPluginParameterValue).toHaveBeenCalledWith('inst-1', 12, 0.43);
    });

    it('answers null when the plugin offers no text', async () => {
        vi.mocked(formatPluginParameterValue).mockResolvedValue(null);

        await expect(formatExternalPluginParameterValue('inst-1', 12, 0.43)).resolves.toBeNull();
    });

    it('logs and answers null instead of throwing when the host refuses', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        vi.mocked(formatPluginParameterValue).mockRejectedValue(new Error('instance is gone'));

        await expect(formatExternalPluginParameterValue('inst-1', 12, 0.43)).resolves.toBeNull();
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });
});

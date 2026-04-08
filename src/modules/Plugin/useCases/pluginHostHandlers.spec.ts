import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeScanPlugins } from './pluginHostHandlers';

describe('pluginHostHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeScanPlugins forwards to startPluginScan', async () => {
        const startPluginScan = vi.fn().mockResolvedValue(undefined);
        injectDependencies(executeScanPlugins, { startPluginScan });

        await executeScanPlugins();

        expect(startPluginScan).toHaveBeenCalledTimes(1);
    });
});

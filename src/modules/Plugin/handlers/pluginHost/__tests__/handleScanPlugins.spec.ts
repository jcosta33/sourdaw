import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleScanPlugins } from '../handleScanPlugins';

vi.mock('../../../useCases/pluginScan/scanning/startPluginScan', () => ({
    startPluginScan: vi.fn().mockResolvedValue(undefined),
}));

import { startPluginScan } from '../../../useCases/pluginScan/scanning/startPluginScan';

describe('handleScanPlugins', () => {
    beforeEach(() => {
        vi.mocked(startPluginScan).mockClear();
    });

    it('forwards to startPluginScan', async () => {
        await handleScanPlugins.execute({ type: 'scanPlugins', payload: undefined });

        expect(startPluginScan).toHaveBeenCalledTimes(1);
    });
});

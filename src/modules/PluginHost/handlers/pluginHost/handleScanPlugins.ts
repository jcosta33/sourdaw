import { createHandler } from '#/utils/createHandler';

import { startPluginScan } from '../../useCases/pluginScan/scanning/startPluginScan';

export const handleScanPlugins = createHandler<'scanPlugins'>({
    execute: async () => {
        await startPluginScan();
    },
    describe: () => ({ label: 'Scan external plugins' }),
    undoable: false,
});

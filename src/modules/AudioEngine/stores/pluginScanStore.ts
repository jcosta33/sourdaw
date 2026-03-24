import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type ScannedPlugin } from '#/modules/Plugin/useCases/pluginScanUseCases';

const logger = Container.getInstance().get(Logger);

export type PluginScanState = {
    scannedPlugins: ScannedPlugin[];
    scanPaths: string[];
    isScanning: boolean;
    lastScanTime: number | null;
    errors: string[];
};

export const defaultPluginScanState: PluginScanState = {
    scannedPlugins: [],
    scanPaths: [],
    isScanning: false,
    lastScanTime: null,
    errors: [],
};

export const pluginScanStore = new Store<PluginScanState>(logger, {
    initialData: defaultPluginScanState,
});

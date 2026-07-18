/**
 * Plugin scan state store.
 * Owned by the Plugin module — scan state is a Plugin concern, not an AudioEngine concern.
 */

import { createStore } from '#/infra/store/createStore';

import { type ScannedPlugin } from '../models/ScannedPlugin';

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

export const pluginScanStore = createStore<PluginScanState>({
    initialData: defaultPluginScanState,
});

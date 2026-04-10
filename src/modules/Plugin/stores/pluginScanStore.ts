/**
 * Plugin scan state store.
 * Owned by the Plugin module — scan state is a Plugin concern, not an AudioEngine concern.
 */

import { createStore } from '#/infra/store/createStore';

export type ScannedPlugin = {
    id: string;
    name: string;
    vendor: string;
    format: string;
    category: string;
    path: string;
    version: string;
    num_inputs: number;
    num_outputs: number;
    num_parameters: number;
    has_custom_ui: boolean;
};

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

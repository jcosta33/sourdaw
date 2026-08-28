import { type ScannedPlugin } from '../../models/ScannedPlugin';

import { getState } from './scanning/helpers';

export function findPluginByName(name: string): ScannedPlugin | undefined {
    const lower = name.toLowerCase();
    return (
        getState().scannedPlugins.find((param) => param.name.toLowerCase() === lower) ??
        getState().scannedPlugins.find((param) => param.name.toLowerCase().includes(lower))
    );
}

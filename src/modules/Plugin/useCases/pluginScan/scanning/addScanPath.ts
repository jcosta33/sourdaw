import { pluginScanStore } from '../../../stores/pluginScanStore';

import { getState } from './helpers';

export function addScanPath(path: string): void {
    const state = getState();
    if (state.scanPaths.includes(path)) {
        return;
    }
    pluginScanStore.set({ ...state, scanPaths: [...state.scanPaths, path] });
}

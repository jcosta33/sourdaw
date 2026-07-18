import { pluginScanStore } from '../../../stores/pluginScanStore';

import { getState } from './helpers';

export function removeScanPath(path: string): void {
    const state = getState();
    pluginScanStore.set({
        ...state,
        scanPaths: state.scanPaths.filter((param) => param !== path),
    });
}

import { describe, it, expect, beforeEach } from 'vitest';

import { defaultPluginScanState, pluginScanStore } from '../../../../stores/pluginScanStore';
import { getState } from '../helpers';

describe('pluginScan scanning helpers', () => {
    beforeEach(() => {
        pluginScanStore.set({ ...defaultPluginScanState, isScanning: true });
    });

    it('should return defaultPluginScanState when store value is null', () => {
        pluginScanStore.set(null);
        expect(getState()).toEqual(defaultPluginScanState);
    });

    it('should return current store value when set', () => {
        expect(getState().isScanning).toBe(true);
    });
});

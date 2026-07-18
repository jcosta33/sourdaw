import { describe, it, expect, beforeEach } from 'vitest';

import { defaultPluginScanState, pluginScanStore } from '../../../../stores/pluginScanStore';
import { removeScanPath } from '../removeScanPath';

describe('removeScanPath', () => {
    beforeEach(() => {
        pluginScanStore.set({ ...defaultPluginScanState, scanPaths: ['/a', '/b', '/c'] });
    });

    it('should remove the matching path and leave others intact', () => {
        removeScanPath('/b');
        expect(pluginScanStore.value?.scanPaths).toEqual(['/a', '/c']);
    });

    it('should not error when the path is missing', () => {
        removeScanPath('/missing');
        expect(pluginScanStore.value?.scanPaths).toEqual(['/a', '/b', '/c']);
    });
});

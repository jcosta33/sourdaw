import { describe, it, expect, beforeEach } from 'vitest';

import { defaultPluginScanState, pluginScanStore } from '../../../../stores/pluginScanStore';
import { addScanPath } from '../addScanPath';

describe('addScanPath', () => {
    beforeEach(() => {
        pluginScanStore.set({ ...defaultPluginScanState, scanPaths: ['/existing'] });
    });

    it('should append a path when it is not already present', () => {
        addScanPath('/new');
        expect(pluginScanStore.value?.scanPaths).toEqual(['/existing', '/new']);
    });

    it('should not duplicate an existing path', () => {
        addScanPath('/existing');
        expect(pluginScanStore.value?.scanPaths).toEqual(['/existing']);
    });
});

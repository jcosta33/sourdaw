import { describe, it, expect } from 'vitest';

import { BUILTIN_PLUGINS } from '../../models/DeviceParameter';
import { getBuiltinPlugins } from '../getBuiltinPlugins';

describe('getBuiltinPlugins', () => {
    it('should return the shared builtin plugin catalog', () => {
        expect(getBuiltinPlugins()).toBe(BUILTIN_PLUGINS);
        expect(getBuiltinPlugins().length).toBeGreaterThan(0);
    });
});

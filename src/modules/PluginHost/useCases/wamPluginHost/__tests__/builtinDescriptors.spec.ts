import { describe, it, expect, beforeEach } from 'vitest';

import { registerBuiltinPlugins } from '../builtinDescriptors';
import { registry } from '../hostOperations/helpers';

describe('registerBuiltinPlugins', () => {
    beforeEach(() => {
        registry.clear();
    });

    it('should register every built-in WAM descriptor', () => {
        registerBuiltinPlugins();
        expect(registry.size).toBe(13);
    });

    it('should make built-in ids retrievable from the registry', () => {
        registerBuiltinPlugins();
        expect(registry.get('sourdaw.eq')?.name).toBe('Parametric EQ');
        expect(registry.get('sourdaw.pro-eq')?.isHighEnd).toBe(true);
    });
});

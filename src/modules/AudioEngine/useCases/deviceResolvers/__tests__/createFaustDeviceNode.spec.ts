import { describe, it, expect } from 'vitest';

import * as subject from '../createFaustDeviceNode';

describe('createFaustDeviceNode', () => {
    it('should export createFaustDeviceNode', () => {
        expect(subject.createFaustDeviceNode).toBeDefined();
        const t = typeof subject.createFaustDeviceNode;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

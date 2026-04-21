import { describe, it, expect } from 'vitest';

import * as subject from '../createFaustDeviceNode';

describe('createFaustDeviceNode', () => {
    it('should export createFaustDeviceNode', () => {
        expect(subject.createFaustDeviceNode).toBeDefined();
        const time = typeof subject.createFaustDeviceNode;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

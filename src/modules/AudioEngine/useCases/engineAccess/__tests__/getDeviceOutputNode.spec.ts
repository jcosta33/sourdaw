import { describe, it, expect } from 'vitest';

import * as subject from '../getDeviceOutputNode';

describe('getDeviceOutputNode', () => {
    it('should export getDeviceOutputNode', () => {
        expect(subject.getDeviceOutputNode).toBeDefined();
        const kind = typeof subject.getDeviceOutputNode;
        expect(kind === 'function' || kind === 'object').toBe(true);
    });
});

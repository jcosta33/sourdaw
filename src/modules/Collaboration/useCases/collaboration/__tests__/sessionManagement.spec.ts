import { describe, it, expect } from 'vitest';

import { sessionRuntimePrimitives } from '../sessionManagement';

describe('sessionRuntimePrimitives', () => {
    it('exposes required properties', () => {
        expect(sessionRuntimePrimitives).toBeDefined();
        expect(sessionRuntimePrimitives.state).toBeDefined();
        expect(typeof sessionRuntimePrimitives.initialize).toBe('function');
        expect(typeof sessionRuntimePrimitives.cleanup).toBe('function');
    });
    it('exposes start functions', () => {
        expect(typeof sessionRuntimePrimitives.startBranchSync).toBe('function');
        expect(typeof sessionRuntimePrimitives.startPlayheadBroadcast).toBe('function');
    });
});

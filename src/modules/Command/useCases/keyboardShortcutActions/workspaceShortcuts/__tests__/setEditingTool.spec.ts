import { describe, it, expect } from 'vitest';

import * as subject from '../setEditingTool';

describe('setEditingTool', () => {
    it('should export setEditingTool', () => {
        expect(subject.setEditingTool).toBeDefined();
        const t = typeof subject.setEditingTool;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

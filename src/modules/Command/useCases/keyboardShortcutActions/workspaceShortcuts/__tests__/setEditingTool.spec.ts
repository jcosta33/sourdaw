import { describe, it, expect } from 'vitest';

import * as subject from '../setEditingTool';

describe('setEditingTool', () => {
    it('should export setEditingTool', () => {
        expect(subject.setEditingTool).toBeDefined();
        const time = typeof subject.setEditingTool;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

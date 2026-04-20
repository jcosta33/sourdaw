import { describe, it, expect } from 'vitest';

import * as subject from '../loadGrandBouleAttackClip';

describe('loadGrandBouleAttackClip', () => {
    it('should export loadGrandBouleAttackClip', () => {
        expect(subject.loadGrandBouleAttackClip).toBeDefined();
        const t = typeof subject.loadGrandBouleAttackClip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

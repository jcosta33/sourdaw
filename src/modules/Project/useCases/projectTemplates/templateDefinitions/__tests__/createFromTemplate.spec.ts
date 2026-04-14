import { describe, it, expect } from 'vitest';
import * as subject from '../createFromTemplate';

describe('createFromTemplate', () => {
    it('should export createFromTemplate', () => {
        expect(subject.createFromTemplate).toBeDefined();
        const t = typeof subject.createFromTemplate;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

import { describe, it, expect } from 'vitest';

import * as subject from '../scheduleClick';

describe('scheduleClick', () => {
    it('should export scheduleClick', () => {
        expect(subject.scheduleClick).toBeDefined();
        const t = typeof subject.scheduleClick;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

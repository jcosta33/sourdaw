import { describe, it, expect } from 'vitest';

import * as subject from '../scheduleClick';

describe('scheduleClick', () => {
    it('should export scheduleClick', () => {
        expect(subject.scheduleClick).toBeDefined();
        const time = typeof subject.scheduleClick;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

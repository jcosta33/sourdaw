import { describe, it, expect } from 'vitest';

import * as subject from '../toggleLaneCollapsed';

describe('toggleLaneCollapsed', () => {
    it('should export toggleLaneCollapsed', () => {
        expect(subject.toggleLaneCollapsed).toBeDefined();
        const time = typeof subject.toggleLaneCollapsed;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

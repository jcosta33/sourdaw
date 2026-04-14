import { describe, it, expect } from 'vitest';
import * as subject from '../toggleLaneCollapsed';

describe('toggleLaneCollapsed', () => {
    it('should export toggleLaneCollapsed', () => {
        expect(subject.toggleLaneCollapsed).toBeDefined();
        const t = typeof subject.toggleLaneCollapsed;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

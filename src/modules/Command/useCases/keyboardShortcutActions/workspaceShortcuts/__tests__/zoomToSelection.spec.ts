import { describe, it, expect } from 'vitest';

import * as subject from '../zoomToSelection';

describe('zoomToSelection', () => {
    it('should export zoomToSelection', () => {
        expect(subject.zoomToSelection).toBeDefined();
        const t = typeof subject.zoomToSelection;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

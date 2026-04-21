import { describe, it, expect } from 'vitest';

import * as subject from '../zoomToSelection';

describe('zoomToSelection', () => {
    it('should export zoomToSelection', () => {
        expect(subject.zoomToSelection).toBeDefined();
        const time = typeof subject.zoomToSelection;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

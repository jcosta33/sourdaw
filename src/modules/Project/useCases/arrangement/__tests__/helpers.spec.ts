import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export loadSnapshot', () => {
        expect(subject.loadSnapshot).toBeDefined();
        const time = typeof subject.loadSnapshot;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export syncCurrentArrangementToStore', () => {
        expect(subject.syncCurrentArrangementToStore).toBeDefined();
        const time = typeof subject.syncCurrentArrangementToStore;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export takeSnapshot', () => {
        expect(subject.takeSnapshot).toBeDefined();
        const time = typeof subject.takeSnapshot;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

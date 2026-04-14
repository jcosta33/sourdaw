import { describe, it, expect } from 'vitest';
import * as subject from '../helpers';

describe('helpers', () => {
    it('should export loadSnapshot', () => {
        expect(subject.loadSnapshot).toBeDefined();
        const t = typeof subject.loadSnapshot;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export syncCurrentArrangementToStore', () => {
        expect(subject.syncCurrentArrangementToStore).toBeDefined();
        const t = typeof subject.syncCurrentArrangementToStore;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export takeSnapshot', () => {
        expect(subject.takeSnapshot).toBeDefined();
        const t = typeof subject.takeSnapshot;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

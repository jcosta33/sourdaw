import { describe, it, expect } from 'vitest';
import * as subject from '../getDsoSnapshotHandlers';

describe('getDsoSnapshotHandlers', () => {
    it('should export getDsoSnapshotHandlers', () => {
        expect(subject.getDsoSnapshotHandlers).toBeDefined();
        const t = typeof subject.getDsoSnapshotHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

import { describe, it, expect } from 'vitest';

import * as subject from '../getDsoSnapshotHandlers';

describe('getDsoSnapshotHandlers', () => {
    it('should export getDsoSnapshotHandlers', () => {
        expect(subject.getDsoSnapshotHandlers).toBeDefined();
        const time = typeof subject.getDsoSnapshotHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

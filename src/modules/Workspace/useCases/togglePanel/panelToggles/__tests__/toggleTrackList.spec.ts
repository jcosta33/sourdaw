import { describe, it, expect } from 'vitest';

import * as subject from '../toggleTrackList';

describe('toggleTrackList', () => {
    it('should export toggleTrackList', () => {
        expect(subject.toggleTrackList).toBeDefined();
        const t = typeof subject.toggleTrackList;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

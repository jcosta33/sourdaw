import { describe, it, expect } from 'vitest';

import * as subject from '../toggleTrackList';

describe('toggleTrackList', () => {
    it('should export toggleTrackList', () => {
        expect(subject.toggleTrackList).toBeDefined();
        const time = typeof subject.toggleTrackList;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

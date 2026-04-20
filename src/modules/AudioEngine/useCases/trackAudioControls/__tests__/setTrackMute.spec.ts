import { describe, it, expect } from 'vitest';

import * as subject from '../setTrackMute';

describe('setTrackMute', () => {
    it('should export setTrackMute', () => {
        expect(subject.setTrackMute).toBeDefined();
        const t = typeof subject.setTrackMute;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

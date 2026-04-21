import { describe, it, expect } from 'vitest';

import * as subject from '../setTrackMute';

describe('setTrackMute', () => {
    it('should export setTrackMute', () => {
        expect(subject.setTrackMute).toBeDefined();
        const time = typeof subject.setTrackMute;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

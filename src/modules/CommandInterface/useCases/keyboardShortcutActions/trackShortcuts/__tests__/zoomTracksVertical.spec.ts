import { describe, it, expect } from 'vitest';

import * as subject from '../zoomTracksVertical';

describe('zoomTracksVertical', () => {
    it('should export zoomTracksVertical', () => {
        expect(subject.zoomTracksVertical).toBeDefined();
        const time = typeof subject.zoomTracksVertical;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

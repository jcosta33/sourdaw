import { describe, it, expect } from 'vitest';

import * as subject from '../getLastClipEndBeat';

describe('getLastClipEndBeat', () => {
    it('should export getLastClipEndBeat', () => {
        expect(subject.getLastClipEndBeat).toBeDefined();
        const time = typeof subject.getLastClipEndBeat;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

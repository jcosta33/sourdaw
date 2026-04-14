import { describe, it, expect } from 'vitest';
import * as subject from '../getLastClipEndBeat';

describe('getLastClipEndBeat', () => {
    it('should export getLastClipEndBeat', () => {
        expect(subject.getLastClipEndBeat).toBeDefined();
        const t = typeof subject.getLastClipEndBeat;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

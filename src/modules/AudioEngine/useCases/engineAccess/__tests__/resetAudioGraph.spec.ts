import { describe, it, expect } from 'vitest';

import * as subject from '../resetAudioGraph';

describe('resetAudioGraph', () => {
    it('should export resetAudioGraph', () => {
        expect(subject.resetAudioGraph).toBeDefined();
        const t = typeof subject.resetAudioGraph;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

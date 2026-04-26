import { describe, it, expect } from 'vitest';

import * as subject from '../resetAudioGraph';

describe('resetAudioGraph', () => {
    it('should export resetAudioGraph', () => {
        expect(subject.resetAudioGraph).toBeDefined();
        const time = typeof subject.resetAudioGraph;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

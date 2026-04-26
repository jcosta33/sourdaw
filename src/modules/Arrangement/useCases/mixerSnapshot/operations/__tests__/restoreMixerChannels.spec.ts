import { describe, it, expect } from 'vitest';

import * as subject from '../restoreMixerChannels';

describe('restoreMixerChannels', () => {
    it('should export restoreMixerChannels', () => {
        expect(subject.restoreMixerChannels).toBeDefined();
        const time = typeof subject.restoreMixerChannels;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

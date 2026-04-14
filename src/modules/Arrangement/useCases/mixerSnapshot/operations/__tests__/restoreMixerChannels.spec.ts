import { describe, it, expect } from 'vitest';
import * as subject from '../restoreMixerChannels';

describe('restoreMixerChannels', () => {
    it('should export restoreMixerChannels', () => {
        expect(subject.restoreMixerChannels).toBeDefined();
        const t = typeof subject.restoreMixerChannels;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

import { describe, it, expect } from 'vitest';

import * as subject from '../getAudioDevices';

describe('getAudioDevices', () => {
    it('should export getAudioDevices', () => {
        expect(subject.getAudioDevices).toBeDefined();
        const time = typeof subject.getAudioDevices;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});

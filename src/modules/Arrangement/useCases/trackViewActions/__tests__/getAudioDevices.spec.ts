import { describe, it, expect } from 'vitest';
import * as subject from '../getAudioDevices';

describe('getAudioDevices', () => {
    it('should export getAudioDevices', () => {
        expect(subject.getAudioDevices).toBeDefined();
        const t = typeof subject.getAudioDevices;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

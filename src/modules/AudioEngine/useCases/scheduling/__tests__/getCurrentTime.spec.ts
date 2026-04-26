import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { getCurrentTime } from '../getCurrentTime';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: { currentTime: 12.5 } as AudioContext,
    },
}));

describe('getCurrentTime', () => {
    beforeEach(() => {
        Object.assign(audioEngine, { context: { currentTime: 12.5 } });
    });

    it('should return the audio context currentTime', () => {
        expect(getCurrentTime()).toBe(12.5);
    });
});

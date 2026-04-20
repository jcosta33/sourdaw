import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getCurrentTime } from '../getCurrentTime';
import { scheduleClick } from '../scheduleClick';
import { stopAllScheduled } from '../stopAllScheduled';

const mocks = vi.hoisted(() => ({
    scheduleClick: vi.fn(),
    stopAllScheduled: vi.fn(),
    context: {
        currentTime: 123.456,
        createOscillator: vi.fn(),
        createGain: vi.fn(),
    },
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: mocks,
}));

describe('Scheduling Use Cases', () => {
    beforeEach(() => vi.clearAllMocks());

    it('scheduleClick delegates to audioEngine', () => {
        scheduleClick(10, true, 0.5);
        expect(mocks.scheduleClick).toHaveBeenCalledWith(10, true, 0.5);
    });

    it('stopAllScheduled delegates to audioEngine', () => {
        stopAllScheduled();
        expect(mocks.stopAllScheduled).toHaveBeenCalledTimes(1);
    });

    it('getCurrentTime returns current context time', () => {
        expect(getCurrentTime()).toBe(123.456);
    });
});

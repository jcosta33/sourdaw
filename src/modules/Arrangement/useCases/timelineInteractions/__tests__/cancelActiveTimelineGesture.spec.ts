import { describe, it, expect, vi, afterEach } from 'vitest';

import { cancelActiveTimelineGesture } from '../cancelActiveTimelineGesture';
import { registerTimelineGestureCanceler } from '../registerTimelineGestureCanceler';

describe('cancelActiveTimelineGesture', () => {
    afterEach(() => {
        registerTimelineGestureCanceler(null);
    });

    it('returns false when no gesture canceler is registered', () => {
        expect(cancelActiveTimelineGesture()).toBe(false);
    });

    it('invokes the registered canceler and reports its result', () => {
        const canceler = vi.fn(() => true);
        registerTimelineGestureCanceler(canceler);

        expect(cancelActiveTimelineGesture()).toBe(true);
        expect(canceler).toHaveBeenCalledTimes(1);
    });

    it('stops invoking a canceler once unregistered', () => {
        const canceler = vi.fn(() => true);
        registerTimelineGestureCanceler(canceler);
        registerTimelineGestureCanceler(null);

        expect(cancelActiveTimelineGesture()).toBe(false);
        expect(canceler).not.toHaveBeenCalled();
    });
});

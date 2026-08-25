import { describe, it, expect, vi } from 'vitest';

import { cancelActiveTimelineGesture } from '../cancelActiveTimelineGesture';
import { registerTimelineGestureCanceler } from '../registerTimelineGestureCanceler';

describe('cancelActiveTimelineGesture', () => {
    it('returns false when no gesture canceler is registered', () => {
        expect(cancelActiveTimelineGesture()).toBe(false);
    });

    it('invokes every registered canceler and reports whether any gesture was active', () => {
        const idle = vi.fn(() => false);
        const active = vi.fn(() => true);
        const unregisterIdle = registerTimelineGestureCanceler(idle);
        const unregisterActive = registerTimelineGestureCanceler(active);
        try {
            expect(cancelActiveTimelineGesture()).toBe(true);
            expect(idle).toHaveBeenCalledTimes(1);
            expect(active).toHaveBeenCalledTimes(1);
        } finally {
            unregisterIdle();
            unregisterActive();
        }
    });

    it('stops invoking a canceler once unregistered', () => {
        const canceler = vi.fn(() => true);
        const unregister = registerTimelineGestureCanceler(canceler);
        unregister();

        expect(cancelActiveTimelineGesture()).toBe(false);
        expect(canceler).not.toHaveBeenCalled();
    });
});

import { describe, it, expect, vi } from 'vitest';

import { cancelActiveTimelineGesture } from '../cancelActiveTimelineGesture';
import { registerTimelineGestureCanceler } from '../registerTimelineGestureCanceler';

describe('cancelActiveTimelineGesture', () => {
    it('returns false when no gesture canceler is registered', () => {
        expect(cancelActiveTimelineGesture()).toBe(false);
    });

    it('invokes every registered canceler and reports whether any gesture was active', () => {
        // The active canceler registers FIRST: a short-circuiting aggregate
        // would return true without ever invoking the idle one.
        const active = vi.fn(() => true);
        const idle = vi.fn(() => false);
        const unregisterActive = registerTimelineGestureCanceler(active);
        const unregisterIdle = registerTimelineGestureCanceler(idle);
        try {
            expect(cancelActiveTimelineGesture()).toBe(true);
            expect(active).toHaveBeenCalledTimes(1);
            expect(idle).toHaveBeenCalledTimes(1);
        } finally {
            unregisterActive();
            unregisterIdle();
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

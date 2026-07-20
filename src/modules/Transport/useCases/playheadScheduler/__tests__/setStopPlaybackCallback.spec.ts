import { describe, it, expect, afterEach } from 'vitest';

import { schedulerSession } from '../schedulerSession';
import { setStopPlaybackCallback } from '../setStopPlaybackCallback';

describe('setStopPlaybackCallback', () => {
    afterEach(() => {
        schedulerSession.onStopRequested = null;
    });

    it('leaves the callback unset until one is registered', () => {
        expect(schedulerSession.onStopRequested).toBeNull();
    });

    it('registers the callback on the scheduler session', () => {
        const callback = (): void => {};

        setStopPlaybackCallback(callback);

        expect(schedulerSession.onStopRequested).toBe(callback);
    });

    it('replaces a previously registered callback', () => {
        const first = (): void => {};
        const second = (): void => {};

        setStopPlaybackCallback(first);
        setStopPlaybackCallback(second);

        expect(schedulerSession.onStopRequested).toBe(second);
        expect(schedulerSession.onStopRequested).not.toBe(first);
    });
});

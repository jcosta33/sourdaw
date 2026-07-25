import { describe, it, expect, beforeEach } from 'vitest';

import { cancelFreezeTrack } from '../cancelFreezeTrack';
import { activeFreezeTasks } from '../freezeTrack';

describe('cancelFreezeTrack', () => {
    beforeEach(() => {
        activeFreezeTasks.clear();
    });

    it('aborts an in-flight freeze and removes it from the active set', () => {
        const controller = new AbortController();
        activeFreezeTasks.set('t1', controller);

        cancelFreezeTrack('t1');

        expect(controller.signal.aborted).toBe(true);
        expect(activeFreezeTasks.has('t1')).toBe(false);
    });

    it('is a no-op when no freeze is in flight for the track', () => {
        cancelFreezeTrack('t2');

        expect(activeFreezeTasks.has('t2')).toBe(false);
    });
});

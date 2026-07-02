import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { countInTimerId, setCountInTimerId } from '../recordingLifecycle';

describe('recording lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setCountInTimerId(null);
    });

    afterEach(() => {
        setCountInTimerId(null);
        vi.useRealTimers();
    });

    it('should update the shared count-in timer handle', () => {
        const timerId = setTimeout(() => {}, 1000);

        setCountInTimerId(timerId);
        expect(countInTimerId).toBe(timerId);

        setCountInTimerId(null);
        expect(countInTimerId).toBeNull();
    });
});

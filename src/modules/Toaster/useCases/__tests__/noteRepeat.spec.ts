import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { getAudioTime } from '#/modules/AudioEngine/useCases';

import { isNoteRepeating, startNoteRepeat, stopNoteRepeat } from '../noteRepeat';
import { triggerToasterPad } from '../triggerPad';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioTime: vi.fn(),
}));

vi.mock('../triggerPad', () => ({
    triggerToasterPad: vi.fn(),
}));

describe('startNoteRepeat', () => {
    beforeEach(() => {
        Container.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        stopNoteRepeat('d1');
        stopNoteRepeat('d2');
        vi.useRealTimers();
    });

    it('fires triggerToasterPad immediately with pad and velocity', () => {
        vi.mocked(getAudioTime).mockReturnValue(0);

        startNoteRepeat('d1', 3, 90, 120, '1/4');

        expect(triggerToasterPad).toHaveBeenCalledWith('d1', 3, 90);
    });

    // Regression — two instances must hold independent sessions: stopping one
    // must not stop the other (previously a single global session).
    it('keeps per-device sessions independent', () => {
        vi.mocked(getAudioTime).mockReturnValue(0);

        startNoteRepeat('d1', 1, 90, 120, '1/4');
        startNoteRepeat('d2', 2, 90, 120, '1/4');
        expect(isNoteRepeating('d1')).toBe(true);
        expect(isNoteRepeating('d2')).toBe(true);

        stopNoteRepeat('d1');
        expect(isNoteRepeating('d1')).toBe(false);
        expect(isNoteRepeating('d2')).toBe(true);
    });

    // Regression — Finding #50: after a long tab-suspend the clock jumps far
    // ahead. The schedule must resync to "now" rather than firing a burst of
    // catch-up triggers. Here one re-arm tick should schedule exactly one
    // follow-up timer, not many.
    it('clamps catch-up after a large clock jump', () => {
        vi.mocked(getAudioTime).mockReturnValue(0);
        startNoteRepeat('d1', 0, 100, 120, '1/16'); // interval 0.125s
        vi.mocked(triggerToasterPad).mockClear();

        // Simulate the tab waking up 10 seconds late (~80 intervals behind).
        vi.mocked(getAudioTime).mockReturnValue(10);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        vi.advanceTimersByTime(125); // fire the next-trigger callback once

        // Exactly one re-arm timer, and the next delay is ~one interval (not 1ms
        // burst), proving we resynced to now instead of replaying missed hits.
        const reArms = setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 125);
        expect(reArms.length).toBe(1);
        setTimeoutSpy.mockRestore();
    });
});

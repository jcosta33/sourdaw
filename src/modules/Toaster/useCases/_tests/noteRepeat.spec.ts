import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { startNoteRepeat, stopNoteRepeat } from '../noteRepeat';

describe('startNoteRepeat', () => {
    beforeEach(() => {
        Container.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        stopNoteRepeat();
        vi.useRealTimers();
    });

    it('fires triggerToasterPad immediately with pad and velocity', () => {
        const triggerToasterPad = vi.fn();
        injectDependencies(startNoteRepeat, {
            getAudioTime: () => 0,
            triggerToasterPad,
        });

        startNoteRepeat(3, 90, 120, '1/4');

        expect(triggerToasterPad).toHaveBeenCalledWith(3, 90);
    });
});

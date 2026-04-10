import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { togglePlayback } from './transportShortcuts';

const noop = (): void => {};

describe('transportShortcuts', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('togglePlayback delegates to the injected implementation', () => {
        const togglePlaybackImpl = vi.fn();
        injectDependencies(togglePlayback, {
            togglePlayback: togglePlaybackImpl,
            stopPlayback: noop,
            toggleLoop: noop,
            toggleMetronome: noop,
            toggleRecording: noop,
            seekPlayhead: noop,
        });

        togglePlayback();

        expect(togglePlaybackImpl).toHaveBeenCalledTimes(1);
    });
});

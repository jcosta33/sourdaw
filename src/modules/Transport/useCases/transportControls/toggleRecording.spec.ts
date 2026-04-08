import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { toggleRecording } from './toggleRecording';

describe('toggleRecording', () => {
    it('should not change transport when state is missing', () => {
        const update = vi.fn();
        injectDependencies(toggleRecording, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        toggleRecording();

        expect(update).not.toHaveBeenCalled();
    });
});

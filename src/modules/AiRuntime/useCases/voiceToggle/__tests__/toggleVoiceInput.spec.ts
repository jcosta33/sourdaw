import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { toggleVoiceInput } from '../toggleVoiceInput';

const mockEventBus = {
    emit: vi.fn(),
};

describe('toggleVoiceInput', () => {
    beforeEach(() => {
        injectDependencies(toggleVoiceInput, { eventBus: mockEventBus });
        vi.clearAllMocks();
    });

    it('rejects an untrusted programmatic event instead of emitting a microphone start', () => {
        toggleVoiceInput(new Event('click'));

        expect(mockEventBus.emit).not.toHaveBeenCalled();
    });
});

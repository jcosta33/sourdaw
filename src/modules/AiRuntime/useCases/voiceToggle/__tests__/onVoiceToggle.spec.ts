import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { onVoiceToggle } from '../onVoiceToggle';

const mockEventBus = {
    on: vi.fn(),
};

describe('onVoiceToggle', () => {
    beforeEach(() => {
        injectDependencies(onVoiceToggle, { eventBus: mockEventBus });
        vi.clearAllMocks();
    });

    it('listens to voice.toggle event on the event bus', () => {
        const handler = vi.fn();
        mockEventBus.on.mockReturnValue(vi.fn<() => void>()); // mock unlisten

        const unlisten = onVoiceToggle(handler);

        expect(mockEventBus.on).toHaveBeenCalledWith('voice.toggle', handler);
        expect(typeof unlisten).toBe('function');
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { eventBus } from '#/app/registerDependencies';

import { onVoiceToggle } from '../onVoiceToggle';

vi.mock('#/app/registerDependencies', () => ({
    eventBus: {
        on: vi.fn(),
    },
}));

describe('onVoiceToggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('listens to voice.toggle event on the event bus', () => {
        const handler = vi.fn();
        vi.mocked(eventBus.on).mockReturnValue(vi.fn<() => void>()); // mock unlisten

        const unlisten = onVoiceToggle(handler);

        expect(eventBus.on).toHaveBeenCalledWith('voice.toggle', handler);
        expect(typeof unlisten).toBe('function');
    });
});

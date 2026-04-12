import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onVoiceToggle } from '../onVoiceToggle';
import { eventBus } from '#/app/registerDependencies';

vi.mock('#/app/registerDependencies', () => ({
    eventBus: {
        on: vi.fn(),
    }
}));

describe('onVoiceToggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('listens to voice.toggle event on the event bus', () => {
        const handler = vi.fn();
        vi.mocked(eventBus.on).mockReturnValue(vi.fn() as any); // mock unlisten

        const unlisten = onVoiceToggle(handler);

        expect(eventBus.on).toHaveBeenCalledWith('voice.toggle', handler);
        expect(typeof unlisten).toBe('function');
    });
});

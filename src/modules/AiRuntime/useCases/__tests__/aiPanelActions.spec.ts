import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAppAction } from '../aiPanelActions/runAppAction';
import { undoLastAction } from '../aiPanelActions/undoLastAction';
import { toggleChat } from '../aiPanelActions/toggleChat';

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    undo: vi.fn(),
}));

vi.mock('#/modules/Workspace/useCases', () => ({
    toggleChatPanel: vi.fn(),
}));

describe('aiPanelActions injectables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('runAppAction forwards to executeAppAction', async () => {
        const { executeAppAction } = await import('#/modules/Command/useCases');
        await runAppAction({ type: 'muteTrack', payload: { trackId: 't1', muted: true } });

        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'muteTrack',
            payload: { trackId: 't1', muted: true },
        });
    });

    it('undoLastAction forwards to undo', async () => {
        const { undo } = await import('#/modules/Command/useCases');
        undoLastAction();

        expect(undo).toHaveBeenCalledTimes(1);
    });

    it('toggleChat forwards to toggleChatPanel', async () => {
        const { toggleChatPanel } = await import('#/modules/Workspace/useCases');
        toggleChat();

        expect(toggleChatPanel).toHaveBeenCalledTimes(1);
    });
});

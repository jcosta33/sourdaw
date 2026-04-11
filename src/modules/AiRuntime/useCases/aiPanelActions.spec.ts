import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { runAppAction } from './aiPanelActions/runAppAction';
import { undoLastAction } from './aiPanelActions/undoLastAction';
import { toggleChat } from './aiPanelActions/toggleChat';

describe('aiPanelActions injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('runAppAction forwards to executeAppAction', async () => {
        const executeAppAction = vi.fn();
        injectDependencies(runAppAction, { executeAppAction });

        await runAppAction({ type: 'muteTrack', payload: { trackId: 't1', muted: true } });

        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'muteTrack',
            payload: { trackId: 't1', muted: true },
        });
    });

    it('undoLastAction forwards to undo', () => {
        const undoFn = vi.fn();
        injectDependencies(undoLastAction, { undo: undoFn });

        undoLastAction();

        expect(undoFn).toHaveBeenCalledTimes(1);
    });

    it('toggleChat forwards to toggleChatPanel', () => {
        const toggleChatPanel = vi.fn();
        injectDependencies(toggleChat, { toggleChatPanel });

        toggleChat();

        expect(toggleChatPanel).toHaveBeenCalledTimes(1);
    });
});

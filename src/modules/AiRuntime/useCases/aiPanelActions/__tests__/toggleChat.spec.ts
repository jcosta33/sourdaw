import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toggleChat } from '../toggleChat';

const mocks = vi.hoisted(() => ({
    toggleChatPanel: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    toggleChatPanel: mocks.toggleChatPanel,
}));

describe('toggleChat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate to toggleChatPanel', () => {
        toggleChat();

        expect(mocks.toggleChatPanel).toHaveBeenCalledTimes(1);
    });
});

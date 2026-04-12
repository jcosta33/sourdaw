import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleChat } from '../toggleChat';

const mocks = vi.hoisted(() => ({
    toggleChatPanel: vi.fn(),
}));

vi.mock('#/modules/Workspace/useCases', () => ({
    toggleChatPanel: mocks.toggleChatPanel,
}));

describe('toggleChat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls toggleChatPanel from Workspace module', () => {
        toggleChat();
        expect(mocks.toggleChatPanel).toHaveBeenCalledTimes(1);
    });
});

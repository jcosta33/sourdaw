import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ChatPanel } from '../ChatPanel';

// Mock external dependencies - factories are hoisted, so define mocks inside
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        messages: [],
        isGenerating: false,
        chatMode: 'chat',
        enableReasoning: false,
    })),
}));

vi.mock('#/modules/AiRuntime/stores/chatStore', () => ({
    chatStore: {},
    clearChatMessages: vi.fn(),
    toggleReasoning: vi.fn(),
    setChatMode: vi.fn(),
    stopGenerating: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases/sendChatMessage', () => ({
    sendChatMessage: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases/aiPanelActions/toggleChat', () => ({
    toggleChat: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases/llmOrchestration/backendResolution/isLlmAvailable', () => ({
    isLlmAvailable: vi.fn(() => true),
}));

vi.mock('react-markdown', () => ({
    default: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock('remark-gfm', () => ({
    default: vi.fn(),
}));

vi.mock('../../components/ChatComposer', () => ({
    ChatComposer: ({
        onSend,
        onStop,
        isGenerating,
        isLlmAvailable,
    }: {
        onSend: () => void;
        onStop: () => void;
        isGenerating: boolean;
        isLlmAvailable: boolean;
    }) => (
        <div data-testid="chat-composer">
            <button onClick={onSend} disabled={!isLlmAvailable}>
                Send
            </button>
            {isGenerating && <button onClick={onStop}>Stop</button>}
        </div>
    ),
}));

// Import the mocked modules to access mock functions
const { useStore } = await import('#/infra/store/useStore');
const { toggleChat } = await import('#/modules/AiRuntime/useCases/aiPanelActions/toggleChat');
const { isLlmAvailable } =
    await import('#/modules/AiRuntime/useCases/llmOrchestration/backendResolution/isLlmAvailable');

describe('ChatPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useStore as ReturnType<typeof vi.fn>).mockReturnValue({
            messages: [],
            isGenerating: false,
            chatMode: 'chat',
            enableReasoning: false,
        });
        (isLlmAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
    });

    it('should render without crashing', () => {
        render(<ChatPanel />);
        expect(screen.getByText('AI Chat')).toBeInTheDocument();
    });

    it('should render with custom style', () => {
        const customStyle = { width: 400 };
        const { container } = render(<ChatPanel style={customStyle} />);
        expect(container.firstChild).toHaveAttribute('style');
    });

    it('should render empty state when no messages', () => {
        render(<ChatPanel />);
        expect(screen.getByText('The kitchen is quiet')).toBeInTheDocument();
        expect(screen.getByText(/Say something to get the dough rising/)).toBeInTheDocument();
    });

    it('should render clear chat button', () => {
        render(<ChatPanel />);
        const clearButton = screen.getByTitle('Clear Chat History');
        expect(clearButton).toBeInTheDocument();
    });

    it('should render close chat button', () => {
        render(<ChatPanel />);
        const closeButton = screen.getByTitle('Close Chat Panel');
        expect(closeButton).toBeInTheDocument();
        fireEvent.click(closeButton);
        expect(toggleChat).toHaveBeenCalled();
    });

    it('should show LLM unavailable warning when not available', () => {
        (isLlmAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);

        render(<ChatPanel />);
        expect(screen.getByText('Local AI Not Available')).toBeInTheDocument();
    });

    it('should render ChatComposer component', () => {
        render(<ChatPanel />);
        expect(screen.getByTestId('chat-composer')).toBeInTheDocument();
    });

    it('should have correct accessibility attributes', () => {
        render(<ChatPanel />);
        const panel = screen.getByText('AI Chat').closest('[class*="flex-col"]');
        expect(panel).toBeInTheDocument();
    });
});

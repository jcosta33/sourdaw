import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiChangeToast } from './AiChangeToast';

// Mock external dependencies
vi.mock('#/modules/AiRuntime/useCases/aiPanelActions', () => ({
    undoLastAction: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases/notifyAiChange', () => ({
    subscribeAiChangeNotification: vi.fn(() => vi.fn()),
}));

// Mock timer for auto-dismiss
vi.useFakeTimers();

describe('AiChangeToast', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = render(<AiChangeToast />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('should return null when no changes', () => {
        const { subscribeAiChangeNotification } = vi.importMock('#/modules/AiRuntime/useCases/notifyAiChange');
        subscribeAiChangeNotification.mockImplementation(() => vi.fn());
        
        const { container } = render(<AiChangeToast />);
        // Initially returns null when no changes
        expect(container.firstChild).toBeNull();
    });

    it('should render toast when changes are present', () => {
        const { subscribeAiChangeNotification } = vi.importMock('#/modules/AiRuntime/useCases/notifyAiChange');
        const mockHandler = vi.fn();
        subscribeAiChangeNotification.mockImplementation((handler) => {
            // Simulate notification being received
            setTimeout(() => {
                handler({
                    summary: 'Test change summary',
                    details: ['Detail 1', 'Detail 2'],
                });
            }, 0);
            return vi.fn();
        });
        
        render(<AiChangeToast />);
        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('should call undoLastAction when undo button is clicked', () => {
        const { undoLastAction } = vi.importMock('#/modules/AiRuntime/useCases/aiPanelActions');
        const { subscribeAiChangeNotification } = vi.importMock('#/modules/AiRuntime/useCases/notifyAiChange');
        
        subscribeAiChangeNotification.mockImplementation((handler) => {
            setTimeout(() => {
                handler({
                    summary: 'Test change',
                    details: [],
                });
            }, 0);
            return vi.fn();
        });
        
        render(<AiChangeToast />);
        
        // Wait for the effect to trigger
        vi.runAllTimers();
        
        const undoButton = screen.getByText('Undo');
        fireEvent.click(undoButton);
        expect(undoLastAction).toHaveBeenCalled();
    });

    it('should dismiss toast when dismiss button is clicked', () => {
        const { subscribeAiChangeNotification } = vi.importMock('#/modules/AiRuntime/useCases/notifyAiChange');
        
        subscribeAiChangeNotification.mockImplementation((handler) => {
            setTimeout(() => {
                handler({
                    summary: 'Test change',
                    details: [],
                });
            }, 0);
            return vi.fn();
        });
        
        const { container } = render(<AiChangeToast />);
        vi.runAllTimers();
        
        const dismissButton = screen.getByText('Dismiss');
        fireEvent.click(dismissButton);
        
        // After dismiss, toast should be gone
        expect(container.querySelector('[role="status"]')).toBeNull();
    });

    it('should have correct aria attributes for accessibility', () => {
        const { subscribeAiChangeNotification } = vi.importMock('#/modules/AiRuntime/useCases/notifyAiChange');
        
        subscribeAiChangeNotification.mockImplementation((handler) => {
            setTimeout(() => {
                handler({
                    summary: 'Test change',
                    details: [],
                });
            }, 0);
            return vi.fn();
        });
        
        render(<AiChangeToast />);
        vi.runAllTimers();
        
        const toast = screen.getByRole('status');
        expect(toast).toHaveAttribute('aria-live', 'polite');
    });
});

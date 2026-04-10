import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AiChangeToast } from './AiChangeToast';

// Mock external dependencies
const mockUndoLastAction = vi.fn();
vi.mock('#/modules/AiRuntime/useCases/aiPanelActions', () => ({
    undoLastAction: () => mockUndoLastAction(),
}));

const mockSubscribeAiChangeNotification = vi.fn(() => vi.fn());
vi.mock('#/modules/AiRuntime/useCases/notifyAiChange', () => ({
    subscribeAiChangeNotification: (handler: unknown) => mockSubscribeAiChangeNotification(handler),
}));

describe('AiChangeToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mockSubscribeAiChangeNotification.mockReturnValue(vi.fn());
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should render without crashing', () => {
        const { container } = render(<AiChangeToast />);
        expect(container).toBeDefined();
    });

    it('should return null when no changes', () => {
        const { container } = render(<AiChangeToast />);
        expect(container.firstChild).toBeNull();
    });

    it('should render toast when changes are present', () => {
        let capturedHandler: (data: any) => void = () => {};
        mockSubscribeAiChangeNotification.mockImplementation((handler: any) => {
            capturedHandler = handler;
            return vi.fn();
        });
        
        render(<AiChangeToast />);
        
        act(() => {
            capturedHandler({
                summary: 'Test change summary',
                details: ['Detail 1', 'Detail 2'],
            });
        });

        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.getByText('Test change summary')).toBeInTheDocument();
    });

    it('should call undoLastAction when undo button is clicked', () => {
        let capturedHandler: (data: any) => void = () => {};
        mockSubscribeAiChangeNotification.mockImplementation((handler: any) => {
            capturedHandler = handler;
            return vi.fn();
        });
        
        render(<AiChangeToast />);
        
        act(() => {
            capturedHandler({
                summary: 'Test change',
                details: [],
            });
        });
        
        const undoButton = screen.getByText(/Undo/i);
        fireEvent.click(undoButton);
        expect(mockUndoLastAction).toHaveBeenCalled();
    });

    it('should dismiss toast when dismiss button is clicked', () => {
        let capturedHandler: (data: any) => void = () => {};
        mockSubscribeAiChangeNotification.mockImplementation((handler: any) => {
            capturedHandler = handler;
            return vi.fn();
        });
        
        render(<AiChangeToast />);
        
        act(() => {
            capturedHandler({
                summary: 'Test change',
                details: [],
            });
        });
        
        expect(screen.getByRole('status')).toBeInTheDocument();
        
        const dismissButton = screen.getByText(/Dismiss/i);
        fireEvent.click(dismissButton);
        
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('should have correct aria attributes for accessibility', () => {
        let capturedHandler: (data: any) => void = () => {};
        mockSubscribeAiChangeNotification.mockImplementation((handler: any) => {
            capturedHandler = handler;
            return vi.fn();
        });
        
        render(<AiChangeToast />);
        
        act(() => {
            capturedHandler({
                summary: 'Test change',
                details: [],
            });
        });

        const toast = screen.getByRole('status');
        expect(toast).toHaveAttribute('aria-live', 'polite');
    });

    it('should auto-dismiss after 5 seconds', () => {
        let capturedHandler: (data: any) => void = () => {};
        mockSubscribeAiChangeNotification.mockImplementation((handler: any) => {
            capturedHandler = handler;
            return vi.fn();
        });
        
        render(<AiChangeToast />);
        
        act(() => {
            capturedHandler({
                summary: 'Auto dismiss test',
                details: [],
            });
        });
        
        expect(screen.getByText('Auto dismiss test')).toBeInTheDocument();
        
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        
        expect(screen.queryByText('Auto dismiss test')).toBeNull();
    });
});

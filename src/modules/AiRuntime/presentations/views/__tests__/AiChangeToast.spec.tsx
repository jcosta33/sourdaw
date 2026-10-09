import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HOSTED_AI_PRIVACY_DISCLOSURE_SUMMARY } from '../../../useCases/aiChangeNotificationState';
import { type AiChangeNotification } from '../../../useCases/notifyAiChange';
import { AiChangeToast } from '../AiChangeToast';

type AiChangeNotificationHandler = (data: AiChangeNotification) => void;

// Mock external dependencies
const mockUndoLastAction = vi.fn();
vi.mock('#/modules/AiRuntime/useCases/aiPanelActions/undoLastAction', () => ({
    undoLastAction: () => {
        mockUndoLastAction();
    },
}));

const mockOpenAnswerInChat = vi.fn();
vi.mock('#/modules/AiRuntime/useCases/aiPanelActions/openAnswerInChat', () => ({
    openAnswerInChat: (...args: unknown[]) => {
        mockOpenAnswerInChat(...args);
    },
}));

const mockSubscribeAiChangeNotification = vi.fn<(handler: AiChangeNotificationHandler) => () => void>(() => vi.fn());
vi.mock('../../../useCases/subscribeAiChangeNotification', () => ({
    subscribeAiChangeNotification: (handler: AiChangeNotificationHandler) => mockSubscribeAiChangeNotification(handler),
}));

type CreateNotificationInput = {
    summary: string;
    details: string[];
    kind: 'applied-change' | 'notice';
};

const createNotification = ({ summary, details, kind }: CreateNotificationInput): AiChangeNotification => {
    return {
        id: `test-${summary}`,
        summary,
        details,
        timestamp: 1_700_000_000_000,
        kind,
    };
};

const captureNotificationHandler = (): { emit: AiChangeNotificationHandler } => {
    let capturedHandler: AiChangeNotificationHandler = () => {};
    mockSubscribeAiChangeNotification.mockImplementation((handler: AiChangeNotificationHandler) => {
        capturedHandler = handler;
        return vi.fn();
    });
    return {
        emit: (notification) => {
            capturedHandler(notification);
        },
    };
};

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
        const { emit } = captureNotificationHandler();

        render(<AiChangeToast />);

        act(() => {
            emit(
                createNotification({
                    summary: 'Test change summary',
                    details: ['Detail 1', 'Detail 2'],
                    kind: 'applied-change',
                })
            );
        });

        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.getByText('Test change summary')).toBeInTheDocument();
    });

    it('should render duplicate details without duplicate-key warnings', () => {
        const { emit } = captureNotificationHandler();
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            render(<AiChangeToast />);

            act(() => {
                emit(
                    createNotification({
                        summary: 'Duplicate detail summary',
                        details: ['Repeated detail', 'Repeated detail'],
                        kind: 'applied-change',
                    })
                );
            });

            expect(screen.getAllByText('Repeated detail')).toHaveLength(2);
            const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter((call) =>
                call.some(
                    (entry) => typeof entry === 'string' && entry.includes('Encountered two children with the same key')
                )
            );
            expect(duplicateKeyWarnings).toEqual([]);
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it('should call undoLastAction when undo button is clicked', () => {
        const { emit } = captureNotificationHandler();

        render(<AiChangeToast />);

        act(() => {
            emit(
                createNotification({
                    summary: 'Test change',
                    details: ['Added track Drums'],
                    kind: 'applied-change',
                })
            );
        });

        const undoButton = screen.getByRole('button', { name: /Undo/i });
        fireEvent.click(undoButton);
        expect(mockUndoLastAction).toHaveBeenCalled();
    });

    it('should not show Undo or Check for a hosted privacy disclosure with details', () => {
        const { emit } = captureNotificationHandler();
        const { container } = render(<AiChangeToast />);

        act(() => {
            emit(
                createNotification({
                    summary: HOSTED_AI_PRIVACY_DISCLOSURE_SUMMARY,
                    details: ['Prompt text may leave this device.'],
                    kind: 'notice',
                })
            );
        });

        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.getByText(HOSTED_AI_PRIVACY_DISCLOSURE_SUMMARY)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Undo/i })).not.toBeInTheDocument();
        expect(container.querySelector('svg.lucide-check')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));

        expect(screen.queryByRole('status')).toBeNull();
        expect(mockUndoLastAction).not.toHaveBeenCalled();
    });

    it('should not show Undo or Check for an empty-details command failure', () => {
        const { emit } = captureNotificationHandler();
        const { container } = render(<AiChangeToast />);

        act(() => {
            emit(
                createNotification({
                    summary: 'Command not executed: the confirmed changes could not be applied.',
                    details: [],
                    kind: 'notice',
                })
            );
        });

        expect(
            screen.getByText('Command not executed: the confirmed changes could not be applied.')
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Undo/i })).not.toBeInTheDocument();
        expect(container.querySelector('svg.lucide-check')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));

        expect(screen.queryByRole('status')).toBeNull();
        expect(mockUndoLastAction).not.toHaveBeenCalled();
    });

    it('should dismiss toast when dismiss button is clicked', () => {
        const { emit } = captureNotificationHandler();

        render(<AiChangeToast />);

        act(() => {
            emit(
                createNotification({
                    summary: 'Test change',
                    details: [],
                    kind: 'notice',
                })
            );
        });

        expect(screen.getByRole('status')).toBeInTheDocument();

        const dismissButton = screen.getByRole('button', { name: /Dismiss/i });
        fireEvent.click(dismissButton);

        expect(screen.queryByRole('status')).toBeNull();
    });

    it('should have correct aria attributes for accessibility', () => {
        const { emit } = captureNotificationHandler();

        render(<AiChangeToast />);

        act(() => {
            emit(
                createNotification({
                    summary: 'Test change',
                    details: [],
                    kind: 'notice',
                })
            );
        });

        const toast = screen.getByRole('status');
        expect(toast).toHaveAttribute('aria-live', 'polite');
    });

    it('should auto-dismiss after 5 seconds', () => {
        const { emit } = captureNotificationHandler();

        render(<AiChangeToast />);

        act(() => {
            emit(
                createNotification({
                    summary: 'Auto dismiss test',
                    details: [],
                    kind: 'notice',
                })
            );
        });

        expect(screen.getByText('Auto dismiss test')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(5000);
        });

        expect(screen.queryByText('Auto dismiss test')).toBeNull();
    });

    describe('a Prompt Bar answer', () => {
        const answer = {
            prompt: 'How loud is the master?',
            text: 'The master integrates at -14.2 LUFS.',
            evidence: [{ callId: 'call-1', toolName: 'analysis.measure', summary: 'Measured the master.' }],
        };
        const answerNotification: AiChangeNotification = {
            id: 'test-answer',
            summary: answer.text,
            details: [],
            timestamp: 1_700_000_000_000,
            kind: 'answer',
            answer,
        };

        it('stays until dismissed, so a long answer can be read', () => {
            const { emit } = captureNotificationHandler();
            render(<AiChangeToast />);

            act(() => {
                emit(answerNotification);
            });
            act(() => {
                vi.advanceTimersByTime(60_000);
            });

            expect(screen.getByText(answer.text)).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
            expect(screen.queryByText(answer.text)).toBeNull();
        });

        it('opens the whole answer in the chat and leaves the notice', () => {
            const { emit } = captureNotificationHandler();
            render(<AiChangeToast />);

            act(() => {
                emit(answerNotification);
            });
            expect(screen.queryByRole('button', { name: /Undo/i })).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: /Open in chat/i }));

            expect(mockOpenAnswerInChat).toHaveBeenCalledExactlyOnceWith(answer);
            expect(screen.queryByRole('status')).toBeNull();
        });

        it('offers no chat action on an ordinary notice', () => {
            const { emit } = captureNotificationHandler();
            render(<AiChangeToast />);

            act(() => {
                emit(createNotification({ summary: 'Command not executed.', details: [], kind: 'notice' }));
            });

            expect(screen.queryByRole('button', { name: /Open in chat/i })).not.toBeInTheDocument();
        });
    });
});

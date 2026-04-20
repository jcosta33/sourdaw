import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MergeResultDialog, type MergeResultData } from '../MergeResultDialog';

describe('MergeResultDialog', () => {
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Successful merge', () => {
        const successResult: MergeResultData = {
            success: true,
            tracksAdded: 2,
            documentsMerged: 3,
            documentsNew: 1,
        };

        it('should render without crashing', () => {
            render(<MergeResultDialog result={successResult} onClose={mockOnClose} />);
            expect(screen.getByText(/Merge Complete/i)).toBeInTheDocument();
        });

        it('should display tracks added count', () => {
            render(<MergeResultDialog result={successResult} onClose={mockOnClose} />);
            expect(screen.getByText(/2 new tracks added/i)).toBeInTheDocument();
        });

        it('should display documents merged count', () => {
            render(<MergeResultDialog result={successResult} onClose={mockOnClose} />);
            expect(screen.getByText(/3 documents merged/i)).toBeInTheDocument();
        });

        it('should display documents new count', () => {
            render(<MergeResultDialog result={successResult} onClose={mockOnClose} />);
            expect(screen.getByText(/1 new document imported/i)).toBeInTheDocument();
        });

        it('should call onClose when Done button is clicked', () => {
            render(<MergeResultDialog result={successResult} onClose={mockOnClose} />);
            const doneButton = screen.getByText(/Done/i);
            fireEvent.click(doneButton);
            expect(mockOnClose).toHaveBeenCalled();
        });
    });

    describe('Failed merge', () => {
        const failedResult: MergeResultData = {
            success: false,
            tracksAdded: 0,
            documentsMerged: 0,
            documentsNew: 0,
            error: 'Merge conflict detected',
        };

        it('should render without crashing', () => {
            render(<MergeResultDialog result={failedResult} onClose={mockOnClose} />);
            expect(screen.getByText(/Merge Failed/i)).toBeInTheDocument();
        });

        it('should display error message', () => {
            render(<MergeResultDialog result={failedResult} onClose={mockOnClose} />);
            expect(screen.getByText(/Merge conflict detected/i)).toBeInTheDocument();
        });

        it('should render Close button for failed merge', () => {
            render(<MergeResultDialog result={failedResult} onClose={mockOnClose} />);
            expect(screen.getByText(/Close/i)).toBeInTheDocument();
        });

        it('should call onClose when Close button is clicked', () => {
            render(<MergeResultDialog result={failedResult} onClose={mockOnClose} />);
            const closeButton = screen.getByText(/Close/i);
            fireEvent.click(closeButton);
            expect(mockOnClose).toHaveBeenCalled();
        });
    });

    describe('No changes merge', () => {
        const noChangesResult: MergeResultData = {
            success: true,
            tracksAdded: 0,
            documentsMerged: 0,
            documentsNew: 0,
        };

        it('should display no changes message', () => {
            render(<MergeResultDialog result={noChangesResult} onClose={mockOnClose} />);
            expect(screen.getByText(/No changes detected/i)).toBeInTheDocument();
        });
    });
});

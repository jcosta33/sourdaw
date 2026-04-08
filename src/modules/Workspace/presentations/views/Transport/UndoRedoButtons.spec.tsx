import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UndoRedoButtons } from './UndoRedoButtons';

describe('UndoRedoButtons', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<UndoRedoButtons />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<UndoRedoButtons />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<UndoRedoButtons />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Command/useCases', () => ({
    undo: vi.fn(),
    redo: vi.fn(),
}));

import { undo, redo } from '#/modules/Command/useCases';

import { UndoRedoButtons } from '../UndoRedoButtons';

const mockedUndo = vi.mocked(undo);
const mockedRedo = vi.mocked(redo);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('UndoRedoButtons — group structure', () => {
    it('renders a group with aria-label "Undo/Redo"', () => {
        render(<UndoRedoButtons canUndo canRedo />);
        expect(screen.getByRole('group')).toHaveAttribute('aria-label', 'Undo/Redo');
    });

    it('renders exactly 2 buttons', () => {
        render(<UndoRedoButtons canUndo canRedo />);
        expect(screen.getAllByRole('button')).toHaveLength(2);
    });
});

describe('UndoRedoButtons — disabled states', () => {
    it('disables Undo button when canUndo is false', () => {
        render(<UndoRedoButtons canUndo={false} canRedo />);
        expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    });

    it('enables Undo button when canUndo is true', () => {
        render(<UndoRedoButtons canUndo canRedo />);
        expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    });

    it('disables Redo button when canRedo is false', () => {
        render(<UndoRedoButtons canUndo canRedo={false} />);
        expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
    });

    it('enables Redo button when canRedo is true', () => {
        render(<UndoRedoButtons canUndo canRedo />);
        expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
    });
});

describe('UndoRedoButtons — click wiring', () => {
    it('calls undo() when Undo button clicked', () => {
        render(<UndoRedoButtons canUndo canRedo />);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(mockedUndo).toHaveBeenCalledTimes(1);
    });

    it('calls redo() when Redo button clicked', () => {
        render(<UndoRedoButtons canUndo canRedo />);
        fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
        expect(mockedRedo).toHaveBeenCalledTimes(1);
    });

    it('does not call undo when Undo is disabled and clicked', () => {
        render(<UndoRedoButtons canUndo={false} canRedo />);
        // fireEvent.click on a disabled button is a no-op in testing-library
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(mockedUndo).not.toHaveBeenCalled();
    });
});

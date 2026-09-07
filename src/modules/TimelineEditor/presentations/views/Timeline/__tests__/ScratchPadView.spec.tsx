import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ScratchPadView } from '../ScratchPadView';

let mockScratchPadState: { sections: Array<Record<string, unknown>> } = { sections: [] };

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => mockScratchPadState),
}));

const removeScratchPadSection = vi.fn();
const renameScratchPadSection = vi.fn();
const setScratchPadSectionColor = vi.fn();
const reorderScratchPadSection = vi.fn();
const clearScratchPad = vi.fn();
const captureArrangementToScratchPad = vi.fn();
const commitScratchPadToArrangement = vi.fn();

vi.mock('#/modules/Arrangement/useCases', () => ({
    removeScratchPadSection: (...args: unknown[]) => removeScratchPadSection(...args),
    renameScratchPadSection: (...args: unknown[]) => renameScratchPadSection(...args),
    setScratchPadSectionColor: (...args: unknown[]) => setScratchPadSectionColor(...args),
    reorderScratchPadSection: (...args: unknown[]) => reorderScratchPadSection(...args),
    clearScratchPad: (...args: unknown[]) => clearScratchPad(...args),
    captureArrangementToScratchPad: (...args: unknown[]) => captureArrangementToScratchPad(...args),
    commitScratchPadToArrangement: (...args: unknown[]) => commitScratchPadToArrangement(...args),
}));

const sectionA = { id: 's1', name: 'Verse', startBeat: 0, endBeat: 8, color: 'oklch(0.5 0.1 260)', order: 0 };
const sectionB = { id: 's2', name: 'Chorus', startBeat: 8, endBeat: 16, color: 'oklch(0.55 0.12 10)', order: 1 };

describe('ScratchPadView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockScratchPadState = { sections: [] };
    });

    it('shows the empty-state hint and hides Apply/Clear when there are no sections', () => {
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        expect(screen.getByText(/Click "Capture" to snapshot/)).toBeInTheDocument();
        expect(screen.queryByTitle('Apply scratch pad to main arrangement')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Clear scratch pad')).not.toBeInTheDocument();
    });

    it('calls captureArrangementToScratchPad when Capture is clicked', () => {
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.click(screen.getByText('Capture'));
        expect(captureArrangementToScratchPad).toHaveBeenCalledWith();
    });

    it('renders sections with their name and beat duration, using fallback color for the placeholder', () => {
        mockScratchPadState = { sections: [sectionA, sectionB] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        expect(screen.getByText('Verse')).toBeInTheDocument();
        expect(screen.getByText('Chorus')).toBeInTheDocument();
        expect(screen.getAllByText('8 beats')).toHaveLength(2);

        const verseBlock = screen.getByText('Verse').closest('div')!;
        expect(verseBlock).toHaveStyle({ backgroundColor: 'oklch(0.40 0.08 260)' });
        const chorusBlock = screen.getByText('Chorus').closest('div')!;
        expect(chorusBlock).toHaveStyle({ backgroundColor: 'oklch(0.55 0.12 10)' });
    });

    it('calls commitScratchPadToArrangement and clearScratchPad from the header buttons', () => {
        mockScratchPadState = { sections: [sectionA] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.click(screen.getByText('Apply'));
        expect(commitScratchPadToArrangement).toHaveBeenCalledWith();
        fireEvent.click(screen.getByLabelText('Clear scratch pad'));
        expect(clearScratchPad).toHaveBeenCalledWith();
    });

    it('collapses and expands, hiding the sections area while collapsed', () => {
        mockScratchPadState = { sections: [sectionA] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.click(screen.getByLabelText('Collapse scratch pad'));
        expect(screen.queryByText('Verse')).not.toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Expand scratch pad'));
        expect(screen.getByText('Verse')).toBeInTheDocument();
    });

    it('calls onToggle when the close button is clicked', () => {
        const onToggle = vi.fn();
        render(<ScratchPadView height={160} onToggle={onToggle} />);
        fireEvent.click(screen.getByLabelText('Close scratch pad'));
        expect(onToggle).toHaveBeenCalled();
    });

    it('renames a section on double-click + Enter, focusing the input', () => {
        mockScratchPadState = { sections: [sectionA] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.doubleClick(screen.getByText('Verse'));

        const input = screen.getByRole('textbox');
        expect(input).toHaveFocus();

        fireEvent.change(input, { target: { value: 'Intro' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(renameScratchPadSection).toHaveBeenCalledWith('s1', 'Intro');
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('cancels renaming on Escape without committing', () => {
        mockScratchPadState = { sections: [sectionA] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.doubleClick(screen.getByText('Verse'));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Intro' } });
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

        expect(renameScratchPadSection).not.toHaveBeenCalled();
        expect(screen.getByText('Verse')).toBeInTheDocument();
    });

    it('does not rename when the trimmed value is empty', () => {
        mockScratchPadState = { sections: [sectionA] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.doubleClick(screen.getByText('Verse'));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

        expect(renameScratchPadSection).not.toHaveBeenCalled();
    });

    it('opens a context menu with Rename, Color, Move and Delete actions', () => {
        mockScratchPadState = { sections: [sectionA, sectionB] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.contextMenu(screen.getByText('Verse'));

        expect(screen.getByText('Rename')).toBeInTheDocument();
        expect(screen.getByText('Color')).toBeInTheDocument();
        expect(screen.getByText('Move Left')).toBeDisabled();
        expect(screen.getByText('Move Right')).not.toBeDisabled();
        expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('sets a section color from the context menu swatches and closes the menu', () => {
        mockScratchPadState = { sections: [sectionA] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.contextMenu(screen.getByText('Verse'));
        fireEvent.click(screen.getByLabelText('Set color oklch(0.40 0.08 150)'));

        expect(setScratchPadSectionColor).toHaveBeenCalledWith('s1', 'oklch(0.40 0.08 150)');
        expect(screen.queryByText('Color')).not.toBeInTheDocument();
    });

    it('reorders sections left/right from the context menu, respecting the disabled edges', () => {
        mockScratchPadState = { sections: [sectionA, sectionB] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.contextMenu(screen.getByText('Chorus'));
        fireEvent.click(screen.getByText('Move Left'));
        expect(reorderScratchPadSection).toHaveBeenCalledWith('s2', 'left');

        fireEvent.contextMenu(screen.getByText('Verse'));
        fireEvent.click(screen.getByText('Move Right'));
        expect(reorderScratchPadSection).toHaveBeenCalledWith('s1', 'right');
    });

    it('opens the rename input from the context menu Rename action', () => {
        mockScratchPadState = { sections: [sectionA] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.contextMenu(screen.getByText('Verse'));
        fireEvent.click(screen.getByText('Rename'));

        expect(screen.getByDisplayValue('Verse')).toBeInTheDocument();
        expect(screen.queryByText('Color')).not.toBeInTheDocument();
    });

    it('removes a section when Delete is clicked in the context menu', () => {
        mockScratchPadState = { sections: [sectionA] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.contextMenu(screen.getByText('Verse'));
        fireEvent.click(screen.getByText('Delete'));
        expect(removeScratchPadSection).toHaveBeenCalledWith('s1');
    });

    it('closes an open context menu on an outside click', () => {
        mockScratchPadState = { sections: [sectionA] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.contextMenu(screen.getByText('Verse'));
        expect(screen.getByText('Delete')).toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });

    // The global shortcut layer gates Delete / Backspace on
    // closest('[role="menu"]') (#3618). The menu's buttons are tab-focusable,
    // so without a menu-role ancestor a Delete from inside would fall through
    // and delete the arrangement clips behind the open menu.
    it('context menu items sit inside a [role="menu"] surface', () => {
        mockScratchPadState = { sections: [sectionA] };
        render(<ScratchPadView height={160} onToggle={vi.fn()} />);
        fireEvent.contextMenu(screen.getByText('Verse'));

        expect(screen.getByText('Delete').closest('[role="menu"]')).not.toBeNull();
    });
});

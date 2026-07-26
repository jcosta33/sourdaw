import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { ProjectName } from '../ProjectName';

const renameProject = vi.hoisted(() => vi.fn());
const saveProject = vi.hoisted(() => vi.fn());

vi.mock('#/modules/Project/useCases', () => ({
    renameProject,
    saveProject,
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('ProjectName', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the project name readout', () => {
        renderWithTooltip(<ProjectName name="My Song" dirty={false} />);

        expect(screen.getByText('My Song')).toBeInTheDocument();
    });

    it('shows the dirty indicator only when dirty is true', () => {
        const { rerender } = renderWithTooltip(<ProjectName name="My Song" dirty={false} />);
        expect(screen.queryByTitle('Unsaved changes')).not.toBeInTheDocument();

        rerender(
            <TooltipProvider>
                <ProjectName name="My Song" dirty={true} />
            </TooltipProvider>
        );

        expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument();
    });

    it('enters edit mode and commits a renamed project via blur', () => {
        renderWithTooltip(<ProjectName name="My Song" dirty={false} />);

        fireEvent.click(screen.getByText('My Song'));

        const input = screen.getByDisplayValue('My Song') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'New Name' } });
        fireEvent.blur(input);

        expect(renameProject).toHaveBeenLastCalledWith('New Name');
    });

    it('trims whitespace when committing', () => {
        renderWithTooltip(<ProjectName name="My Song" dirty={false} />);

        fireEvent.click(screen.getByText('My Song'));
        const input = screen.getByDisplayValue('My Song') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '   Spaced   ' } });
        fireEvent.blur(input);

        expect(renameProject).toHaveBeenLastCalledWith('Spaced');
    });

    it('does not rename when the trimmed value is empty', () => {
        renderWithTooltip(<ProjectName name="My Song" dirty={false} />);

        fireEvent.click(screen.getByText('My Song'));
        const input = screen.getByDisplayValue('My Song') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.blur(input);

        expect(renameProject).not.toHaveBeenCalled();
    });

    it('does not rename when the value is unchanged', () => {
        renderWithTooltip(<ProjectName name="My Song" dirty={false} />);

        fireEvent.click(screen.getByText('My Song'));
        const input = screen.getByDisplayValue('My Song') as HTMLInputElement;
        fireEvent.blur(input);

        expect(renameProject).not.toHaveBeenCalled();
    });

    it('commits on Enter key', () => {
        renderWithTooltip(<ProjectName name="My Song" dirty={false} />);

        fireEvent.click(screen.getByText('My Song'));
        const input = screen.getByDisplayValue('My Song') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Enter Name' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(renameProject).toHaveBeenLastCalledWith('Enter Name');
    });

    it('cancels editing on Escape without renaming', () => {
        renderWithTooltip(<ProjectName name="My Song" dirty={false} />);

        fireEvent.click(screen.getByText('My Song'));
        const input = screen.getByDisplayValue('My Song') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Discarded' } });
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(renameProject).not.toHaveBeenCalled();
        // Edit input is gone, name readout is back.
        expect(screen.queryByDisplayValue('Discarded')).not.toBeInTheDocument();
    });

    it('seeds the editor with the current name when re-opened', () => {
        const { rerender } = renderWithTooltip(<ProjectName name="First" dirty={false} />);

        // Change the prop; opening the editor must seed with the new name, not a
        // stale value captured on first mount.
        rerender(
            <TooltipProvider>
                <ProjectName name="Second" dirty={false} />
            </TooltipProvider>
        );

        fireEvent.click(screen.getByText('Second'));
        expect(screen.getByDisplayValue<HTMLInputElement>('Second').value).toBe('Second');
    });

    it('triggers saveProject on double-click without entering edit mode', () => {
        renderWithTooltip(<ProjectName name="My Song" dirty={false} />);

        fireEvent.doubleClick(screen.getByText('My Song'));

        expect(saveProject).toHaveBeenCalledTimes(1);
        // Double-click does not open the editor (no input element rendered).
        expect(screen.queryByDisplayValue('My Song')).not.toBeInTheDocument();
    });
});

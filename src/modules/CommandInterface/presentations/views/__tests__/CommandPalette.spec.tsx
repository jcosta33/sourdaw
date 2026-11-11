import { useState } from 'react';

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CommandPalette } from '../CommandPalette';
import { searchCommands } from '../commandRegistry';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
}));

const closeHook = vi.hoisted(() => ({ onClose: () => {} }));

vi.mock('#/modules/WorkspaceShell/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/WorkspaceShell/useCases')>()),
    closeCommandPalette: () => closeHook.onClose(),
}));

const { useStore } = await import('#/infra/store/useStore');
const { executeUserAppAction } = await import('#/modules/Command/useCases');

describe('CommandPalette', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useStore).mockReturnValue({ commandPaletteOpen: true });
        vi.mocked(executeUserAppAction).mockImplementation(async (_action, options) => {
            options?.onCommitted?.();
        });
    });

    it('exposes ARIA combobox and listbox active-descendant relationships when open', () => {
        render(<CommandPalette />);
        const commands = ['toggle-playback', 'undo'].map((id) => {
            const command = searchCommands('').find((candidate) => candidate.id === id);
            if (!command) {
                throw new Error(`Expected registered command ${id}`);
            }
            return command;
        });
        const firstCommand = commands[0];
        const secondCommand = commands[1];
        expect(firstCommand).toBeDefined();
        expect(secondCommand).toBeDefined();
        if (!firstCommand || !secondCommand) {
            throw new Error('Expected at least two registered commands');
        }

        const input = screen.getByRole('combobox');
        expect(input).toHaveAttribute('aria-autocomplete', 'list');
        expect(input).toHaveAttribute('aria-expanded', 'true');
        expect(input).toHaveAttribute('aria-haspopup', 'listbox');
        expect(input).toHaveAttribute('aria-controls', 'command-palette-listbox');
        expect(input).toHaveAttribute('aria-activedescendant', `command-palette-option-${firstCommand.id}`);

        const listbox = screen.getByRole('listbox');
        expect(listbox).toHaveAttribute('id', 'command-palette-listbox');
        expect(listbox).toHaveAttribute('aria-label', 'Commands');

        const options = screen.getAllByRole('option');
        const option0 = options[0];
        const option1 = options[1];
        expect(option0).toBeDefined();
        expect(option1).toBeDefined();
        if (!option0 || !option1) {
            throw new Error('Expected at least two command options');
        }

        expect(option0).toHaveAttribute('id', `command-palette-option-${firstCommand.id}`);
        expect(option0).toHaveAttribute('aria-selected', 'true');

        expect(option1).toHaveAttribute('id', `command-palette-option-${secondCommand.id}`);
        expect(option1).toHaveAttribute('aria-selected', 'false');
    });

    it('returns focus to the control that had it when Escape closes the palette', async () => {
        const Host = () => {
            const [open, setOpen] = useState(false);
            closeHook.onClose = () => setOpen(false);
            vi.mocked(useStore).mockReturnValue({ commandPaletteOpen: open });
            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>
                        Undo
                    </button>
                    <CommandPalette />
                </>
            );
        };
        render(<Host />);
        const opener = screen.getByRole('button', { name: 'Undo' });
        opener.focus();
        fireEvent.click(opener);
        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveFocus();
        });

        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

        await waitFor(() => {
            expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
            expect(opener).toHaveFocus();
        });
    });

    it('advances selection and updates aria-activedescendant on ArrowDown keydown', () => {
        render(<CommandPalette />);
        const commands = ['toggle-playback', 'undo'].map((id) => {
            const command = searchCommands('').find((candidate) => candidate.id === id);
            if (!command) {
                throw new Error(`Expected registered command ${id}`);
            }
            return command;
        });
        const firstCommand = commands[0];
        const secondCommand = commands[1];
        expect(firstCommand).toBeDefined();
        expect(secondCommand).toBeDefined();
        if (!firstCommand || !secondCommand) {
            throw new Error('Expected at least two registered commands');
        }

        const input = screen.getByRole('combobox');
        const options = screen.getAllByRole('option');
        const option0 = options[0];
        const option1 = options[1];
        expect(option0).toBeDefined();
        expect(option1).toBeDefined();
        if (!option0 || !option1) {
            throw new Error('Expected at least two command options');
        }

        expect(input).toHaveAttribute('aria-activedescendant', `command-palette-option-${firstCommand.id}`);
        expect(option0).toHaveAttribute('aria-selected', 'true');
        expect(option1).toHaveAttribute('aria-selected', 'false');

        fireEvent.keyDown(input, { key: 'ArrowDown' });

        expect(input).toHaveAttribute('aria-activedescendant', `command-palette-option-${secondCommand.id}`);
        expect(option0).toHaveAttribute('aria-selected', 'false');
        expect(option1).toHaveAttribute('aria-selected', 'true');
    });

    it('filters the rendered command options for a positive query', () => {
        render(<CommandPalette />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'track' } });

        expect(screen.getByRole('option', { name: /Add MIDI Track/ })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /Duplicate Track/ })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /Save Project/ })).not.toBeInTheDocument();
    });

    it('restores discovery and finds named commands after the positive query is cleared', () => {
        render(<CommandPalette />);
        const input = screen.getByRole('combobox');

        expect(screen.getByRole('option', { name: /Add Audio Track/ })).toBeInTheDocument();
        fireEvent.change(input, { target: { value: 'track' } });
        expect(screen.queryByRole('option', { name: /Save Project/ })).not.toBeInTheDocument();

        fireEvent.change(input, { target: { value: '' } });
        expect(screen.getByRole('option', { name: /Add Audio Track/ })).toBeInTheDocument();

        fireEvent.change(input, { target: { value: 'save project' } });
        expect(screen.getByRole('option', { name: /Save Project/ })).toBeInTheDocument();
    });

    it('moves selection back up on ArrowUp keydown', () => {
        render(<CommandPalette />);
        const commands = ['toggle-playback', 'undo'].map((id) => {
            const command = searchCommands('').find((candidate) => candidate.id === id);
            if (!command) {
                throw new Error(`Expected registered command ${id}`);
            }
            return command;
        });
        const firstCommand = commands[0];
        const secondCommand = commands[1];
        expect(firstCommand).toBeDefined();
        expect(secondCommand).toBeDefined();
        if (!firstCommand || !secondCommand) {
            throw new Error('Expected at least two registered commands');
        }

        const input = screen.getByRole('combobox');
        const options = screen.getAllByRole('option');
        const option0 = options[0];
        const option1 = options[1];
        expect(option0).toBeDefined();
        expect(option1).toBeDefined();
        if (!option0 || !option1) {
            throw new Error('Expected at least two command options');
        }

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(input).toHaveAttribute('aria-activedescendant', `command-palette-option-${secondCommand.id}`);

        fireEvent.keyDown(input, { key: 'ArrowUp' });
        expect(input).toHaveAttribute('aria-activedescendant', `command-palette-option-${firstCommand.id}`);
        expect(option0).toHaveAttribute('aria-selected', 'true');
        expect(option1).toHaveAttribute('aria-selected', 'false');
    });

    it('executes the active option from flattened grouped order on Enter keydown', () => {
        render(<CommandPalette />);
        const command = searchCommands('').find((candidate) => candidate.id === 'add-audio-track');
        if (!command) {
            throw new Error('Expected registered Add Audio Track command');
        }
        const input = screen.getByRole('combobox');

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(input).toHaveAttribute('aria-activedescendant', 'command-palette-option-add-audio-track');
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(executeUserAppAction).toHaveBeenCalledWith(command.action, { onCommitted: expect.any(Function) });
    });

    it('updates selection and aria-activedescendant on pointer move over an option', () => {
        render(<CommandPalette />);
        const commands = ['toggle-playback', 'undo'].map((id) => {
            const command = searchCommands('').find((candidate) => candidate.id === id);
            if (!command) {
                throw new Error(`Expected registered command ${id}`);
            }
            return command;
        });
        const secondCommand = commands[1];
        expect(secondCommand).toBeDefined();
        if (!secondCommand) {
            throw new Error('Expected at least two registered commands');
        }

        const input = screen.getByRole('combobox');
        const options = screen.getAllByRole('option');
        const option0 = options[0];
        const option1 = options[1];
        expect(option0).toBeDefined();
        expect(option1).toBeDefined();
        if (!option0 || !option1) {
            throw new Error('Expected at least two command options');
        }

        fireEvent.pointerMove(option1);

        expect(input).toHaveAttribute('aria-activedescendant', `command-palette-option-${secondCommand.id}`);
        expect(option1).toHaveAttribute('aria-selected', 'true');
        expect(option0).toHaveAttribute('aria-selected', 'false');
    });

    it('clears aria-activedescendant and shows no commands message when query has no matching results', () => {
        render(<CommandPalette />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'nonexistent-query-that-matches-nothing' } });

        expect(input).not.toHaveAttribute('aria-activedescendant');
        expect(screen.getByText('No commands found')).toBeInTheDocument();
        expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('dispatches an activated entry with a committed-outcome observer on click', () => {
        render(<CommandPalette />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'metronome' } });
        fireEvent.click(screen.getByRole('option', { name: /Toggle Metronome/ }));

        expect(executeUserAppAction).toHaveBeenCalledWith(
            { type: 'toggleMetronome' },
            { onCommitted: expect.any(Function) }
        );
    });

    it('shows a small categorized discovery set instead of the full registry for an empty query', () => {
        render(<CommandPalette />);

        expect(screen.getAllByRole('option').length).toBeLessThan(searchCommands('').length);
        expect(screen.getByRole('group', { name: 'Transport' })).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Edit' })).toBeInTheDocument();
    });

    it.each([
        { query: 'metronome', option: /Toggle Metronome/ },
        { query: 'Add Bus Track', option: /Add Bus Track/ },
    ])('puts the committed $option command in Recent when the query is cleared', async ({ query, option }) => {
        render(<CommandPalette />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: query } });
        fireEvent.click(screen.getByRole('option', { name: option }));
        fireEvent.change(input, { target: { value: '' } });

        await waitFor(() => expect(screen.getByRole('group', { name: 'Recent' })).toBeInTheDocument());
        expect(screen.getAllByRole('option')[0]).toHaveAccessibleName(option);
    });

    it.each([
        { query: 'metronome', option: /Toggle Metronome/ },
        { query: 'Add Bus Track', option: /Add Bus Track/ },
    ])('keeps the uncommitted $option command out of Recent', ({ query, option }) => {
        vi.mocked(executeUserAppAction).mockResolvedValue(undefined);
        render(<CommandPalette />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: query } });
        fireEvent.click(screen.getByRole('option', { name: option }));
        fireEvent.change(input, { target: { value: '' } });

        expect(screen.queryByRole('group', { name: 'Recent' })).not.toBeInTheDocument();
    });

    it('explains a missing clip selection before execution without dispatching the command', () => {
        render(<CommandPalette />);
        const input = screen.getByRole('combobox');
        fireEvent.change(input, { target: { value: 'Quantize Notes' } });

        const option = screen.getByRole('option', { name: /Quantize Notes/ });
        expect(option).toHaveAccessibleName(/Select a MIDI clip first/);
        expect(option).toHaveAttribute('aria-disabled', 'true');
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(executeUserAppAction).not.toHaveBeenCalled();
        expect(input).toBeInTheDocument();
    });

    it('pulls focus back to the input when something outside the open palette takes it', async () => {
        render(
            <>
                <button type="button">Outside</button>
                <CommandPalette />
            </>
        );
        const input = screen.getByRole('combobox');
        await waitFor(() => {
            expect(input).toHaveFocus();
        });

        screen.getByRole('button', { name: 'Outside', hidden: true }).focus();

        expect(document.activeElement).toBe(input);
    });
});

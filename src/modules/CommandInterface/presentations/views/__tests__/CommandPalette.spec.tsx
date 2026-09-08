import { render, screen, fireEvent } from '@testing-library/react';
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

const { useStore } = await import('#/infra/store/useStore');
const { executeUserAppAction } = await import('#/modules/Command/useCases');

describe('CommandPalette', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useStore).mockReturnValue({ commandPaletteOpen: true });
    });

    it('exposes ARIA combobox and listbox active-descendant relationships when open', () => {
        render(<CommandPalette />);
        const commands = searchCommands('');
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

    it('advances selection and updates aria-activedescendant on ArrowDown keydown', () => {
        render(<CommandPalette />);
        const commands = searchCommands('');
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

    it('moves selection back up on ArrowUp keydown', () => {
        render(<CommandPalette />);
        const commands = searchCommands('');
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

    it('executes the active option on Enter keydown', () => {
        render(<CommandPalette />);
        const commands = searchCommands('');
        const secondCommand = commands[1];
        expect(secondCommand).toBeDefined();
        if (!secondCommand) {
            throw new Error('Expected at least two registered commands');
        }

        const input = screen.getByRole('combobox');

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(executeUserAppAction).toHaveBeenCalledWith(secondCommand.action);
    });

    it('updates selection and aria-activedescendant on pointer move over an option', () => {
        render(<CommandPalette />);
        const commands = searchCommands('');
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

    it('dispatches an activated entry through executeUserAppAction on click', () => {
        render(<CommandPalette />);
        const entry = screen.getByText('Toggle Metronome');
        fireEvent.click(entry.closest('[role="option"]') ?? entry);

        expect(executeUserAppAction).toHaveBeenCalledWith({ type: 'toggleMetronome' });
    });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { getToolShortcutKeys } from '../../../models/EditingTool';
import { ShortcutCheatSheet } from '../ShortcutCheatSheet';

function rowsOf(title: string): { description: string; keys: string }[] {
    const stack = screen.getByText(title).nextElementSibling;
    return Array.from(stack?.children ?? []).map((row) => ({
        description: row.children[0]?.textContent ?? '',
        keys: Array.from(row.children[1]?.children ?? [])
            .map((keycap) => keycap.textContent)
            .join(' '),
    }));
}

describe('ShortcutCheatSheet', () => {
    it('should open when ? is pressed', () => {
        render(<ShortcutCheatSheet />);
        expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
        fireEvent.keyDown(window, { key: '?' });
        expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
        expect(screen.getByText('Transport')).toBeTruthy();
    });
});

describe('ShortcutCheatSheet — open/close lifecycle', () => {
    it('renders nothing when closed', () => {
        render(<ShortcutCheatSheet />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes when the Escape key is pressed while open', () => {
        render(<ShortcutCheatSheet />);
        fireEvent.keyDown(window, { key: '?' });
        expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes when the close button is clicked', () => {
        render(<ShortcutCheatSheet />);
        fireEvent.keyDown(window, { key: '?' });
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('ShortcutCheatSheet — shortcut groups rendered', () => {
    it('renders all shortcut group titles when open', () => {
        render(<ShortcutCheatSheet />);
        fireEvent.keyDown(window, { key: '?' });
        for (const title of ['Transport', 'Tools (letter)', 'Tools (number)', 'Editing']) {
            expect(screen.getByText(title)).toBeTruthy();
        }
    });

    it('renders shortcut descriptions with keycap labels', () => {
        render(<ShortcutCheatSheet />);
        fireEvent.keyDown(window, { key: '?' });
        // "Play / Pause" description is under Transport
        expect(screen.getByText('Play / Pause')).toBeTruthy();
        // "Undo" description is under Editing
        expect(screen.getByText('Undo')).toBeTruthy();
    });
});

describe('ShortcutCheatSheet — focus management', () => {
    it('moves focus into the dialog on open and restores it on close', () => {
        // `aria-modal="true"` tells assistive tech the rest of the app is gone. If
        // focus never enters the dialog, a screen reader is not told it opened and
        // Tab continues from wherever the user already was.
        const opener = document.createElement('button');
        document.body.append(opener);
        opener.focus();
        expect(document.activeElement).toBe(opener);

        render(<ShortcutCheatSheet />);
        fireEvent.keyDown(window, { key: '?' });

        expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Keyboard shortcuts' }));

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(document.activeElement).toBe(opener);
        opener.remove();
    });
});

describe('ShortcutCheatSheet — tool keys', () => {
    const TOOL_ROWS = [
        ['select', 'Select tool'],
        ['cut', 'Cut / Split tool'],
        ['draw', 'Draw tool'],
        ['automation', 'Automation tool'],
        ['stretch', 'Stretch tool'],
        ['marquee', 'Marquee tool'],
    ] as const;

    it('shows each tool exactly the keys that select it, and no automation letter', () => {
        render(<ShortcutCheatSheet />);
        fireEvent.keyDown(window, { key: '?' });

        const shown = [...rowsOf('Tools (letter)'), ...rowsOf('Tools (number)')];

        expect(
            TOOL_ROWS.map(([tool, description]) => ({
                tool,
                keys: shown
                    .filter((row) => row.description === description)
                    .map((row) => row.keys)
                    .sort(),
            }))
        ).toStrictEqual(TOOL_ROWS.map(([tool]) => ({ tool, keys: [...getToolShortcutKeys(tool)].sort() })));
        expect(rowsOf('Tools (letter)').map((row) => row.keys)).not.toContain('A');
    });

    it('lists the store-owned shortcuts under View / Zoom', () => {
        render(<ShortcutCheatSheet storeShortcuts={[{ keys: 'A', description: 'Cycle Automation Visibility' }]} />);
        fireEvent.keyDown(window, { key: '?' });

        expect(rowsOf('View / Zoom')).toContainEqual({ description: 'Cycle Automation Visibility', keys: 'A' });
    });

    it('does not advertise bindings the keyboard handler lacks', () => {
        render(<ShortcutCheatSheet />);
        fireEvent.keyDown(window, { key: '?' });

        expect(screen.queryByText('Voice command (hold)')).toBeNull();
        expect(screen.queryByText('Deselect all')).toBeNull();
    });
});

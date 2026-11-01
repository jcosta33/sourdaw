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

function allRows(): { description: string; keys: string }[] {
    const titles = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent ?? '');
    return titles.flatMap(rowsOf);
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

        const keysShownFor = (description: string): string[] => {
            const rows = shown.filter((row) => row.description === description);
            const keys = rows.map((row) => row.keys);
            return keys.sort();
        };
        const actual = TOOL_ROWS.map(([tool, description]) => ({ tool, keys: keysShownFor(description) }));
        const expected = TOOL_ROWS.map(([tool]) => ({ tool, keys: [...getToolShortcutKeys(tool)].sort() }));

        expect(actual).toStrictEqual(expected);

        const letterKeys = rowsOf('Tools (letter)').map((row) => row.keys);
        expect(letterKeys).not.toContain('A');
    });

    it('lists the store-owned shortcuts under View / Zoom', () => {
        render(<ShortcutCheatSheet storeShortcuts={[{ keys: 'A', description: 'Cycle Automation Visibility' }]} />);
        fireEvent.keyDown(window, { key: '?' });

        expect(rowsOf('View / Zoom')).toContainEqual({ description: 'Cycle Automation Visibility', keys: 'A' });
    });

    it('does not advertise bindings the keyboard handler lacks', () => {
        render(<ShortcutCheatSheet />);
        fireEvent.keyDown(window, { key: '?' });

        const shownKeys = allRows().map((row) => row.keys);

        expect(shownKeys).not.toContain('V');
        expect(shownKeys).not.toContain('⌘ ⇧ A');
    });
});

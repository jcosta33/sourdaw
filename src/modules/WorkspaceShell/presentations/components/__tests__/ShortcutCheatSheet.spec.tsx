import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ShortcutCheatSheet } from '../ShortcutCheatSheet';

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

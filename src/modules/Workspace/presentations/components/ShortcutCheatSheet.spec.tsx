import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutCheatSheet } from './ShortcutCheatSheet';

describe('ShortcutCheatSheet', () => {
    it('should open when ? is pressed', () => {
        render(<ShortcutCheatSheet />);
        expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
        fireEvent.keyDown(window, { key: '?' });
        expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
        expect(screen.getByText('Transport')).toBeInTheDocument();
    });
});

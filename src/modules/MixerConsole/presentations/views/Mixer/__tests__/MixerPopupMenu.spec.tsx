import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { MixerPopupMenu, MixerPopupOption, MixerPopupLabel, MixerPopupSeparator } from '../MixerPopupMenu';

describe('MixerPopupMenu', () => {
    it('positions itself absolutely by default and renders its children', () => {
        render(
            <MixerPopupMenu role="menu">
                <span>menu content</span>
            </MixerPopupMenu>
        );

        const menu = screen.getByRole('menu');
        expect(menu).toHaveClass('absolute');
        expect(menu).not.toHaveClass('fixed');
        expect(screen.getByText('menu content')).toBeInTheDocument();
    });

    it('positions itself fixed when position="fixed"', () => {
        render(
            <MixerPopupMenu role="menu" position="fixed">
                <span>menu content</span>
            </MixerPopupMenu>
        );

        const menu = screen.getByRole('menu');
        expect(menu).toHaveClass('fixed');
        expect(menu).not.toHaveClass('absolute');
    });

    it('renders exactly the menu items passed as children, separated by a divider', () => {
        render(
            <MixerPopupMenu role="menu">
                <MixerPopupOption role="menuitem">First</MixerPopupOption>
                <MixerPopupSeparator data-testid="divider" />
                <MixerPopupOption role="menuitem">Second</MixerPopupOption>
            </MixerPopupMenu>
        );

        const menu = screen.getByRole('menu');
        expect(
            within(menu)
                .getAllByRole('menuitem')
                .map((item) => item.textContent)
        ).toEqual(['First', 'Second']);
        expect(screen.getByTestId('divider')).toBeInTheDocument();
    });
});

describe('MixerPopupOption', () => {
    it('calls its onClick handler when clicked', () => {
        const onClick = vi.fn();
        render(<MixerPopupOption onClick={onClick}>Rename…</MixerPopupOption>);

        fireEvent.click(screen.getByText('Rename…'));

        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('applies the active accent styling when active', () => {
        render(<MixerPopupOption active>Selected</MixerPopupOption>);
        expect(screen.getByRole('button', { name: 'Selected' })).toHaveClass('text-[var(--color-accent-cyan)]');
    });

    it('does not apply the active accent styling when inactive', () => {
        render(<MixerPopupOption>Unselected</MixerPopupOption>);
        expect(screen.getByRole('button', { name: 'Unselected' })).not.toHaveClass('text-[var(--color-accent-cyan)]');
    });

    it('renders a shortcut hint alongside the label', () => {
        render(<MixerPopupOption shortcut="⌘R">Rename…</MixerPopupOption>);
        expect(screen.getByText('⌘R')).toBeInTheDocument();
    });
});

describe('MixerPopupLabel', () => {
    it('renders its children as a section label', () => {
        render(<MixerPopupLabel>VCA Group</MixerPopupLabel>);
        expect(screen.getByText('VCA Group')).toBeInTheDocument();
    });
});

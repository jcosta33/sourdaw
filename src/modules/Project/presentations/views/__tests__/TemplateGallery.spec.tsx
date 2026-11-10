import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TemplateGallery } from '../TemplateGallery';

const TEMPLATES = [
    { id: 'pop-song', name: 'Pop Song', description: 'A band', category: 'music' },
    { id: 'podcast', name: 'Podcast Booth', description: 'A talk show', category: 'podcast' },
    {
        id: 'demo-nebula-drift',
        name: 'Nebula Drift',
        description: 'A long description that must wrap inside the card instead of running past its edge.',
        category: 'demo',
    },
] as const;

describe('TemplateGallery', () => {
    it('shows every template under All and marks All as the checked filter', () => {
        render(<TemplateGallery templates={TEMPLATES} onSelect={vi.fn()} />);

        expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getAllByRole('button')).toHaveLength(3);
    });

    it('narrows the cards and moves the checked state when a category is chosen', () => {
        render(<TemplateGallery templates={TEMPLATES} onSelect={vi.fn()} />);

        fireEvent.click(screen.getByRole('radio', { name: 'Podcast' }));

        expect(screen.getByRole('radio', { name: 'Podcast' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('button', { name: /Podcast Booth/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Pop Song/ })).not.toBeInTheDocument();
    });

    it('opens on the requested initial category', () => {
        render(<TemplateGallery templates={TEMPLATES} onSelect={vi.fn()} initialCategory="demo" />);

        expect(screen.getByRole('radio', { name: 'Demos' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('button', { name: /Nebula Drift/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Pop Song/ })).not.toBeInTheDocument();
    });

    it('reports the id of the selected template', () => {
        const onSelect = vi.fn();
        render(<TemplateGallery templates={TEMPLATES} onSelect={onSelect} />);

        fireEvent.click(screen.getByRole('button', { name: /Pop Song/ }));

        expect(onSelect).toHaveBeenCalledExactlyOnceWith('pop-song');
    });

    it('reports the id of a card that is not the first one', () => {
        const onSelect = vi.fn();
        render(<TemplateGallery templates={TEMPLATES} onSelect={onSelect} />);

        fireEvent.click(screen.getByRole('button', { name: /Nebula Drift/ }));

        expect(onSelect).toHaveBeenCalledExactlyOnceWith('demo-nebula-drift');
    });

    it('reports the id of a card chosen after narrowing to a category', () => {
        const onSelect = vi.fn();
        render(<TemplateGallery templates={TEMPLATES} onSelect={onSelect} />);

        fireEvent.click(screen.getByRole('radio', { name: 'Podcast' }));
        fireEvent.click(screen.getByRole('button', { name: /Podcast Booth/ }));

        expect(onSelect).toHaveBeenCalledExactlyOnceWith('podcast');
    });

    it.each(['Demos', 'Music', 'Podcast', 'Film', 'All'])(
        'labels the active %s chip in the foreground color so it clears 4.5:1',
        (name) => {
            render(<TemplateGallery templates={TEMPLATES} onSelect={vi.fn()} />);

            fireEvent.click(screen.getByRole('radio', { name }));

            const chip = screen.getByRole('radio', { name });
            expect(chip.className).toContain('text-foreground');
            expect(chip.className).not.toContain('text-[var(--color-accent');
        }
    );

    it('pads the scroll area on every side so a focus ring is not clipped', () => {
        render(<TemplateGallery templates={TEMPLATES} onSelect={vi.fn()} />);

        const grid = screen.getByRole('button', { name: /Pop Song/ }).parentElement;
        expect(grid?.className).toMatch(/(^|\s)p-1(\s|$)/);
    });

    it('renders cards as native buttons that can wrap their description', () => {
        render(<TemplateGallery templates={TEMPLATES} onSelect={vi.fn()} />);

        const card = screen.getByRole('button', { name: /Nebula Drift/ });
        expect(card.tagName).toBe('BUTTON');
        expect(card).toHaveAttribute('type', 'button');
        expect(card.className).not.toContain('whitespace-nowrap');
        expect(card.className).toContain('min-w-0');
        expect(screen.getByText(/must wrap inside the card/).className).toContain('line-clamp-2');
    });

    it('disables every card while disabled', () => {
        const onSelect = vi.fn();
        render(<TemplateGallery templates={TEMPLATES} onSelect={onSelect} disabled />);

        for (const card of screen.getAllByRole('button')) {
            expect(card).toBeDisabled();
        }
        fireEvent.click(screen.getByRole('button', { name: /Pop Song/ }));
        expect(onSelect).not.toHaveBeenCalled();
    });

    it.each([
        ['Pop Song', 'music'],
        ['Podcast Booth', 'mic'],
        ['Nebula Drift', 'sparkles'],
    ])('draws the %s card with the %s icon of its category, whatever its id', (name, icon) => {
        render(<TemplateGallery templates={TEMPLATES} onSelect={vi.fn()} />);

        const card = screen.getByRole('button', { name: new RegExp(name) });
        expect(card.querySelector(`svg.lucide-${icon}`)).not.toBeNull();
        expect(card.querySelector('svg.lucide-file-text')).toBeNull();
    });

    it('uses the same icon on a category chip and on its cards', () => {
        render(<TemplateGallery templates={TEMPLATES} onSelect={vi.fn()} />);

        expect(screen.getByRole('radio', { name: 'Music' }).querySelector('svg.lucide-music')).not.toBeNull();
        expect(screen.getByRole('radio', { name: 'Demos' }).querySelector('svg.lucide-sparkles')).not.toBeNull();
    });

    it('keeps the grid from scrolling sideways', () => {
        render(<TemplateGallery templates={TEMPLATES} onSelect={vi.fn()} />);

        const grid = screen.getByRole('button', { name: /Pop Song/ }).parentElement;
        expect(grid?.className).toContain('overflow-x-hidden');
        expect(grid?.className).toContain('overflow-y-auto');
    });
});

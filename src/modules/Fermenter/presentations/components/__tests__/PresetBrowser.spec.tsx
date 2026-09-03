import { type ComponentProps } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { PresetBrowser } from '../PresetBrowser';

type Preset = { id: string; name: string; category: string; tags?: string[] };

const FIXTURE_PRESETS: Preset[] = [
    { id: 'p1', name: 'Fermenter — Lead One', category: 'lead', tags: ['analog', 'warm'] },
    { id: 'p2', name: 'Fermenter — Bass Acid', category: 'bass', tags: ['acid', 'aggressive'] },
    { id: 'p3', name: 'Fermenter — Pad Drift', category: 'pad', tags: ['ambient', 'warm'] },
    { id: 'p4', name: 'Fermenter — Lead FM', category: 'lead', tags: ['fm'] },
];

function defaultProps(overrides: Partial<ComponentProps<typeof PresetBrowser>> = {}) {
    return {
        currentName: 'Init',
        userPatches: [{ id: 'u1', name: 'My Patch' }],
        presets: FIXTURE_PRESETS,
        onLoadPreset: vi.fn(),
        ...overrides,
    };
}

describe('PresetBrowser', () => {
    describe('initial render', () => {
        it('renders the search input and lists every preset with the "Fermenter — " prefix stripped', () => {
            render(<PresetBrowser {...defaultProps()} />);
            expect(screen.getByPlaceholderText(/search/i)).toBeTruthy();
            expect(screen.getByText('Lead One')).toBeTruthy();
            expect(screen.getByText('Bass Acid')).toBeTruthy();
            expect(screen.getByText('Pad Drift')).toBeTruthy();
            // the raw prefixed name must not appear anywhere
            expect(screen.queryByText('Fermenter — Lead One')).toBeNull();
        });

        it('shows the total preset count in the footer', () => {
            render(<PresetBrowser {...defaultProps()} />);
            expect(screen.getByText('4 presets')).toBeTruthy();
        });
    });

    describe('search filtering', () => {
        it('filters by name (case-insensitive substring) and updates the count', () => {
            render(<PresetBrowser {...defaultProps()} />);
            fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'acid' } });
            expect(screen.getByText('Bass Acid')).toBeTruthy();
            expect(screen.queryByText('Lead One')).toBeNull();
            expect(screen.getByText('1 presets')).toBeTruthy();
        });

        it('filters by tag content, not just name', () => {
            render(<PresetBrowser {...defaultProps()} />);
            // "warm" is a tag on Lead One and Pad Drift, not in either name
            fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'WARM' } });
            expect(screen.getByText('Lead One')).toBeTruthy();
            expect(screen.getByText('Pad Drift')).toBeTruthy();
            expect(screen.queryByText('Bass Acid')).toBeNull();
            expect(screen.getByText('2 presets')).toBeTruthy();
        });

        it('renders the empty-state message when nothing matches', () => {
            render(<PresetBrowser {...defaultProps()} />);
            fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'zzzz' } });
            expect(screen.getByText('No presets found')).toBeTruthy();
            expect(screen.getByText('0 presets')).toBeTruthy();
        });
    });

    describe('category filtering', () => {
        it('narrows to a category when its pill is clicked and resets the selected tag', () => {
            render(<PresetBrowser {...defaultProps()} />);
            // first select a tag to prove it gets reset on category change
            fireEvent.click(screen.getByText('#fm'));
            expect(screen.getByText('1 presets')).toBeTruthy();
            // now switch to the lead category
            fireEvent.click(screen.getByText('Lead', { selector: 'button' }));
            // tag reset → both leads show (Lead One + Lead FM)
            expect(screen.getByText('Lead One')).toBeTruthy();
            expect(screen.getByText('Lead FM')).toBeTruthy();
            expect(screen.queryByText('Bass Acid')).toBeNull();
            expect(screen.getByText('2 presets')).toBeTruthy();
        });

        it('marks the active category pill with white text', () => {
            render(<PresetBrowser {...defaultProps()} />);
            const bassPill = screen.getByText('Bass', { selector: 'button' });
            expect(bassPill.className).not.toContain('text-white');
            fireEvent.click(bassPill);
            expect(bassPill.className).toContain('text-white');
        });

        it('sets the active pill inline background to the category color token', () => {
            render(<PresetBrowser {...defaultProps()} />);
            const bassPill = screen.getByText('Bass', { selector: 'button' });
            expect(bassPill.getAttribute('style')).toBeNull();
            fireEvent.click(bassPill);
            // Bass category maps to the danger color token
            expect(bassPill.style.backgroundColor).toBe('var(--color-state-danger)');
        });

        it('falls back to the lavender token for the "All" pill which has no own color', () => {
            render(<PresetBrowser {...defaultProps()} />);
            // "All" is the default-active category; its color is null → lavender fallback
            const allPill = screen.getByText('All', { selector: 'button' });
            expect(allPill.style.backgroundColor).toBe('var(--color-accent-lavender)');
        });

        it('sets aria-pressed to true on the active category pill', () => {
            render(<PresetBrowser {...defaultProps()} />);
            const allPill = screen.getByText('All', { selector: 'button' });
            const bassPill = screen.getByText('Bass', { selector: 'button' });
            expect(allPill).toHaveAttribute('aria-pressed', 'true');
            expect(bassPill).toHaveAttribute('aria-pressed', 'false');
            fireEvent.click(bassPill);
            expect(allPill).toHaveAttribute('aria-pressed', 'false');
            expect(bassPill).toHaveAttribute('aria-pressed', 'true');
        });
    });

    describe('user patches category', () => {
        it('derives the list from userPatches (not presets) when "My Patches" is selected', () => {
            render(<PresetBrowser {...defaultProps()} />);
            fireEvent.click(screen.getByText('My Patches'));
            expect(screen.getByText('My Patch')).toBeTruthy();
            // preset-derived entries must be gone
            expect(screen.queryByText('Lead One')).toBeNull();
            expect(screen.getByText('1 presets')).toBeTruthy();
        });

        it('hides the tag filter bar in the user category', () => {
            render(<PresetBrowser {...defaultProps()} />);
            // tag bar present in default (all) category
            expect(screen.getByText('#analog')).toBeTruthy();
            fireEvent.click(screen.getByText('My Patches'));
            expect(screen.queryByText('#analog')).toBeNull();
        });
    });

    describe('tag filtering', () => {
        it('toggles a tag filter on then off', () => {
            render(<PresetBrowser {...defaultProps()} />);
            const acidTag = screen.getByText('#acid');
            fireEvent.click(acidTag);
            expect(screen.getByText('Bass Acid')).toBeTruthy();
            expect(screen.queryByText('Lead One')).toBeNull();
            expect(screen.getByText('1 presets')).toBeTruthy();
            // toggling off restores the full list
            fireEvent.click(acidTag);
            expect(screen.getByText('Lead One')).toBeTruthy();
            expect(screen.getByText('4 presets')).toBeTruthy();
        });

        it('highlights the selected tag with the muted background class', () => {
            render(<PresetBrowser {...defaultProps()} />);
            const fmTag = screen.getByText('#fm');
            expect(fmTag.className).not.toContain('bg-muted');
            fireEvent.click(fmTag);
            expect(fmTag.className).toContain('bg-muted');
        });
    });

    describe('current-preset highlight', () => {
        it('highlights the preset whose stripped name equals currentName', () => {
            render(<PresetBrowser {...defaultProps({ currentName: 'Bass Acid' })} />);
            const bassButton = screen.getByText('Bass Acid').closest('button')!;
            expect(bassButton.className).toContain('bg-[var(--color-accent-lavender)]/15');
        });

        it('also highlights when currentName still carries the "Fermenter — " prefix', () => {
            render(<PresetBrowser {...defaultProps({ currentName: 'Fermenter — Lead One' })} />);
            const leadButton = screen.getByText('Lead One').closest('button')!;
            expect(leadButton.className).toContain('bg-[var(--color-accent-lavender)]/15');
        });

        it('does not highlight a non-current preset', () => {
            render(<PresetBrowser {...defaultProps({ currentName: 'Bass Acid' })} />);
            const leadButton = screen.getByText('Lead One').closest('button')!;
            expect(leadButton.className).not.toContain('bg-[var(--color-accent-lavender)]/15');
            expect(leadButton.className).toContain('hover:bg-surface-raised');
        });
    });

    describe('load callback', () => {
        it('calls onLoadPreset with the clicked preset id', () => {
            const onLoadPreset = vi.fn();
            render(<PresetBrowser {...defaultProps({ onLoadPreset })} />);
            fireEvent.click(screen.getByText('Pad Drift'));
            expect(onLoadPreset).toHaveBeenCalledWith('p3');
        });
    });
});

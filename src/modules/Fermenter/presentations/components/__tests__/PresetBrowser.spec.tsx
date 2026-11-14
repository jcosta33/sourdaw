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
        userPatches: [{ id: 'u1', name: 'My Patch' }],
        presets: FIXTURE_PRESETS,
        onLoadPreset: vi.fn(),
        onStepPreset: vi.fn(),
        currentPresetId: 'p1',
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

        it('marks the active category pill with the rendered surface foreground', () => {
            render(<PresetBrowser {...defaultProps()} />);
            const bassPill = screen.getByText('Bass', { selector: 'button' });
            expect(bassPill).not.toHaveClass('text-surface-panel');
            expect(bassPill.style.color).toBe('');
            fireEvent.click(bassPill);
            expect(bassPill).toHaveClass('text-surface-panel');
            expect(bassPill.style.color).toBe('var(--color-surface-panel)');
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
            expect(fmTag).toHaveAttribute('aria-pressed', 'false');
            fireEvent.click(fmTag);
            expect(fmTag.className).toContain('bg-muted');
            expect(fmTag).toHaveAttribute('aria-pressed', 'true');
        });
    });

    describe('current-preset highlight', () => {
        it('highlights the same preset identity that filtered stepping uses', () => {
            render(<PresetBrowser {...defaultProps({ currentPresetId: 'p2' })} />);
            expect(screen.getByRole('button', { name: 'Bass Acid' }).className).toContain(
                'bg-[var(--color-accent-lavender)]/15'
            );
            expect(screen.getByRole('button', { name: 'Lead One' }).className).not.toContain(
                'bg-[var(--color-accent-lavender)]/15'
            );
        });

        it('does not highlight a same-name successor with a different preset identity', () => {
            const presets = [
                ...FIXTURE_PRESETS,
                { id: 'replacement', name: 'Fermenter — Lead One', category: 'lead', tags: [] },
            ];
            render(<PresetBrowser {...defaultProps({ presets })} />);
            const matches = screen.getAllByRole('button', { name: 'Lead One' });
            expect(matches[0]!.className).toContain('bg-[var(--color-accent-lavender)]/15');
            expect(matches[1]!.className).not.toContain('bg-[var(--color-accent-lavender)]/15');
        });

        it('leaves every preset unhighlighted when the actual patch has no registry identity', () => {
            render(<PresetBrowser {...defaultProps({ currentPresetId: null })} />);
            expect(screen.getByRole('button', { name: 'Lead One' }).className).not.toContain(
                'bg-[var(--color-accent-lavender)]/15'
            );
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

    describe('filtered preset stepping', () => {
        it('steps through search results rather than registry neighbours and wraps at both ends', () => {
            const onStepPreset = vi.fn();
            render(<PresetBrowser {...defaultProps({ onStepPreset })} />);
            fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'warm' } });

            fireEvent.click(screen.getByRole('button', { name: 'Next preset' }));
            expect(onStepPreset).toHaveBeenLastCalledWith('p3');
            fireEvent.click(screen.getByRole('button', { name: 'Previous preset' }));
            expect(onStepPreset).toHaveBeenLastCalledWith('p3');
        });

        it('steps through user patches and wraps from the first patch to the last', () => {
            const onStepPreset = vi.fn();
            render(
                <PresetBrowser
                    {...defaultProps({
                        currentPresetId: 'u1',
                        onStepPreset,
                        userPatches: [
                            { id: 'u1', name: 'My Patch' },
                            { id: 'u2', name: 'Second Patch' },
                        ],
                    })}
                />
            );
            fireEvent.click(screen.getByText('My Patches'));

            fireEvent.click(screen.getByRole('button', { name: 'Previous preset' }));
            expect(onStepPreset).toHaveBeenLastCalledWith('u2');
            fireEvent.click(screen.getByRole('button', { name: 'Next preset' }));
            expect(onStepPreset).toHaveBeenLastCalledWith('u2');
        });

        it('starts at the first filtered result when the current patch is outside the result set', () => {
            const onStepPreset = vi.fn();
            render(<PresetBrowser {...defaultProps({ currentPresetId: 'p2', onStepPreset })} />);
            fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'lead' } });

            fireEvent.click(screen.getByRole('button', { name: 'Next preset' }));
            expect(onStepPreset).toHaveBeenLastCalledWith('p1');
        });

        it('disables both explicitly named stepping controls when no preset matches', () => {
            render(<PresetBrowser {...defaultProps()} />);
            fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'zzzz' } });

            expect(screen.getByRole('button', { name: 'Previous preset' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Next preset' })).toBeDisabled();
        });
    });

    it('gives filtering and preset controls minimum targets with legible semantic labels', () => {
        render(<PresetBrowser {...defaultProps()} />);

        expect(screen.getByPlaceholderText('Search presets…')).toHaveClass('h-6', 'text-[length:var(--text-nano)]');
        for (const control of [
            screen.getByRole('button', { name: 'Lead', pressed: false }),
            screen.getByRole('button', { name: '#warm' }),
            screen.getByRole('button', { name: 'Lead One' }),
        ]) {
            expect(control).toHaveClass('min-h-6', 'text-[length:var(--text-nano)]');
        }
    });
});

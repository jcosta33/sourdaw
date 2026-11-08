import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type FermenterSection, SectionNav } from '../SectionNav';

const SECTION_LABELS: Array<[FermenterSection, string]> = [
    ['osc', 'Oscillator'],
    ['filter', 'Filter'],
    ['env', 'Envelopes'],
    ['mod', 'Modulation'],
    ['fx', 'Effects'],
];

describe('SectionNav', () => {
    it('exposes a named tablist with exactly the active section selected', () => {
        render(<SectionNav active="filter" onChange={vi.fn()} />);

        expect(screen.getByRole('tablist', { name: 'Fermenter sections' })).toBeInTheDocument();
        expect(screen.getAllByRole('tab')).toHaveLength(SECTION_LABELS.length);
        for (const [section, label] of SECTION_LABELS) {
            const tab = screen.getByRole('tab', { name: label });
            expect(tab).toHaveAttribute('aria-selected', String(section === 'filter'));
            expect(tab).toHaveAttribute('aria-controls', 'fermenter-section-panel');
        }
    });

    it('keeps each selected section’s accent styling', () => {
        const accents: Record<FermenterSection, string> = {
            osc: 'lavender',
            filter: 'cyan',
            env: 'mint',
            mod: 'peach',
            fx: 'lavender',
        };

        for (const [section, label] of SECTION_LABELS) {
            const { unmount } = render(<SectionNav active={section} onChange={vi.fn()} />);
            expect(screen.getByRole('tab', { name: label })).toHaveClass(
                `bg-[var(--color-accent-${accents[section]})]`,
                'text-white'
            );
            unmount();
        }
    });

    it.each(SECTION_LABELS)('routes a %s tab click to onChange with that section id', (section, label) => {
        const onChange = vi.fn();
        render(<SectionNav active="osc" onChange={onChange} />);
        fireEvent.click(screen.getByRole('tab', { name: label }));
        expect(onChange).toHaveBeenCalledWith(section);
    });

    it('uses shared keyboard navigation without changing the section on arrow focus', () => {
        const onChange = vi.fn();
        render(<SectionNav active="osc" onChange={onChange} />);
        const oscillator = screen.getByRole('tab', { name: 'Oscillator' });
        const filter = screen.getByRole('tab', { name: 'Filter' });
        oscillator.focus();

        fireEvent.keyDown(oscillator, { key: 'ArrowRight' });

        expect(filter).toHaveFocus();
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.click(filter);
        expect(onChange).toHaveBeenCalledExactlyOnceWith('filter');
    });
});

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
            expect(screen.getByRole('tab', { name: label })).toHaveAttribute(
                'aria-selected',
                String(section === 'filter')
            );
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

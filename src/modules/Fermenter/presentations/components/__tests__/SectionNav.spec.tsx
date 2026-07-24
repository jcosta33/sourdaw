import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type FermenterSection, SectionNav } from '../SectionNav';

// SECTIONS = ['osc','filter','env','mod','fx'] → labels Oscillator/Filter/Envelopes/Modulation/Effects
const SECTION_LABELS: Array<[FermenterSection, RegExp]> = [
    ['osc', /oscillator/i],
    ['filter', /filter/i],
    ['env', /envelopes/i],
    ['mod', /modulation/i],
    ['fx', /effects/i],
];

describe('SectionNav', () => {
    it('renders a tab button for every section', () => {
        render(<SectionNav active="osc" onChange={vi.fn()} />);
        for (const [, label] of SECTION_LABELS) {
            expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
        }
    });

    it.each(SECTION_LABELS)('routes a %s tab click to onChange with that section id', (section, label) => {
        const onChange = vi.fn();
        render(<SectionNav active="osc" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(onChange).toHaveBeenCalledWith(section);
    });
});

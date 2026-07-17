import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/ProofPatch';
import { ProofEqSection } from '../ProofEqSection';

describe('ProofEqSection', () => {
    it('should render', () => {
        render(<ProofEqSection patch={DEFAULT_PATCH} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getAllByText('EQ').length).toBeGreaterThan(0);
    });

    it('gives every EQ band control a distinct accessible name', () => {
        render(<ProofEqSection patch={DEFAULT_PATCH} gestureOwner={0} onPatchChange={vi.fn()} />);

        const names = screen.getAllByRole('slider').map((control) => control.getAttribute('aria-label'));

        expect(names).toEqual([
            'EQ band 1 high pass',
            'EQ band 2 low shelf',
            'EQ band 3 peak',
            'EQ band 4 peak',
            'EQ band 5 peak',
            'EQ band 6 peak',
            'EQ band 7 high shelf',
            'EQ band 8 low pass',
            'EQ Low Cut frequency',
            'EQ Low Cut gain',
            'EQ Low Cut Q',
            'EQ Low Shelf frequency',
            'EQ Low Shelf gain',
            'EQ Low Shelf Q',
            'EQ Low-Mid frequency',
            'EQ Low-Mid gain',
            'EQ Low-Mid Q',
            'EQ Mid frequency',
            'EQ Mid gain',
            'EQ Mid Q',
            'EQ High-Mid frequency',
            'EQ High-Mid gain',
            'EQ High-Mid Q',
            'EQ High frequency',
            'EQ High gain',
            'EQ High Q',
            'EQ High Shelf frequency',
            'EQ High Shelf gain',
            'EQ High Shelf Q',
            'EQ High Cut frequency',
            'EQ High Cut gain',
            'EQ High Cut Q',
        ]);
        expect(new Set(names).size).toBe(names.length);
    });

    it('names the module toggle and every band enable button while exposing pressed state', () => {
        render(<ProofEqSection patch={DEFAULT_PATCH} gestureOwner={0} onPatchChange={vi.fn()} />);

        const moduleToggle = screen.getByRole('button', { name: 'EQ module' });
        expect(moduleToggle).toHaveAttribute('aria-pressed', String(!DEFAULT_PATCH.eqBypassed));

        const bandButtons = screen.getAllByRole('button', { name: /EQ .* band$/ });
        expect(bandButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
            'EQ Low Cut band',
            'EQ Low Shelf band',
            'EQ Low-Mid band',
            'EQ Mid band',
            'EQ High-Mid band',
            'EQ High band',
            'EQ High Shelf band',
            'EQ High Cut band',
        ]);
        expect(bandButtons.map((button) => button.getAttribute('aria-pressed'))).toEqual(
            DEFAULT_PATCH.eqBands.map((band) => String(band.enabled))
        );
    });
});

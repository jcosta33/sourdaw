import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_BAND } from '../../../models/BacteriaPatch';
import { BandStrip } from '../BandStrip';

describe('BandStrip', () => {
    it('should render', () => {
        render(<BandStrip index={0} band={DEFAULT_BAND} isActive onSelect={vi.fn()} onParamChange={vi.fn()} />);
        expect(screen.getByText(/band 1/i)).toBeInTheDocument();
        fireEvent.click(screen.getByText('S'));
    });

    it('labels its gain slider with the band number for an accessible name', () => {
        // BandStrip renders its visible label as a sibling span; the gain knob
        // must still carry an accessible name (not fall back to the generic
        // "Parameter control"), and that name must distinguish per-band knobs.
        const { rerender } = render(
            <BandStrip index={0} band={DEFAULT_BAND} isActive onSelect={vi.fn()} onParamChange={vi.fn()} />
        );
        expect(screen.getByRole('slider', { name: 'Band 1 gain' })).toBeInTheDocument();

        rerender(<BandStrip index={2} band={DEFAULT_BAND} isActive onSelect={vi.fn()} onParamChange={vi.fn()} />);
        expect(screen.getByRole('slider', { name: 'Band 3 gain' })).toBeInTheDocument();
    });
});

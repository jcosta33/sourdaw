import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { GrMeter } from '../GrMeter';

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: (_prop: string, fallback: string) => fallback,
}));

describe('GrMeter', () => {
    it('should render a canvas', () => {
        const { container } = render(<GrMeter grDb={-2} width={40} height={80} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('should round aria-valuenow to one decimal to match the visible readout', () => {
        const { getByRole } = render(<GrMeter grDb={-4.234567} width={40} height={80} />);
        const meter = getByRole('meter');
        // Display prints grDb.toFixed(1) → -4.2; aria-valuenow must not leak the raw float.
        expect(meter.getAttribute('aria-valuenow')).toBe('-4.2');
    });

    it('should expose a human-readable aria-valuetext', () => {
        const { getByRole } = render(<GrMeter grDb={-4.234567} width={40} height={80} />);
        expect(getByRole('meter').getAttribute('aria-valuetext')).toBe('-4.2 dB of gain reduction');
    });

    it('should use a per-instance label to disambiguate multiple meters', () => {
        const { getByLabelText } = render(<GrMeter grDb={-2} width={40} height={80} label="Bus A gain reduction" />);
        expect(getByLabelText('Bus A gain reduction').getAttribute('role')).toBe('meter');
    });

    it('should set canvas dimensions from width and height props', async () => {
        const { container } = render(<GrMeter grDb={-2} width={40} height={80} />);
        const canvas = container.querySelector('canvas');
        await vi.waitFor(() => {
            expect(canvas?.width).toBeGreaterThan(0);
            expect(canvas?.height).toBeGreaterThan(0);
        });
    });
});

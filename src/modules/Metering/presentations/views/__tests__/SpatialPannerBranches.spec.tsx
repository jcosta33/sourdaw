import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#5090c0'),
}));

import { SpatialPanner } from '../SpatialPanner';

/**
 * Specs for SpatialPanner. The existing spec only checks canvas.toBeInTheDocument().
 * These cover: slider role, aria-label computation, aria-valuenow/min/max,
 * onChange callback firing, and default props.
 */

beforeEach(() => {
    vi.clearAllMocks();
});

describe('SpatialPanner — slider structure', () => {
    it('renders a canvas with role="slider"', () => {
        render(<SpatialPanner />);
        expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('aria-valuemin is -180', () => {
        render(<SpatialPanner />);
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemin', '-180');
    });

    it('aria-valuemax is 180', () => {
        render(<SpatialPanner />);
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemax', '180');
    });
});

describe('SpatialPanner — aria-label and aria-valuenow from initial props', () => {
    it('aria-label contains azimuth and distance', () => {
        render(<SpatialPanner azimuth={45} distance={0.7} />);
        const slider = screen.getByRole('slider');
        const label = slider.getAttribute('aria-label') ?? '';
        expect(label).toContain('45');
        expect(label).toContain('azimuth');
        expect(label).toContain('70');
        expect(label).toContain('distance');
    });

    it('aria-valuenow reflects the initial azimuth', () => {
        render(<SpatialPanner azimuth={90} distance={0.5} />);
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '90');
    });

    it('default azimuth is 0 and default distance is 0.5', () => {
        render(<SpatialPanner />);
        const slider = screen.getByRole('slider');
        expect(slider).toHaveAttribute('aria-valuenow', '0');
        const label = slider.getAttribute('aria-label') ?? '';
        expect(label).toContain('50%');
    });
});

describe('SpatialPanner — onChange callback', () => {
    it('calls onChange when canvas is clicked', () => {
        const onChange = vi.fn();
        const { container } = render(<SpatialPanner onChange={onChange} size={120} />);
        const canvas = container.querySelector('canvas')!;

        // getBoundingClientRect is not available in jsdom; mock it.
        canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 120,
            height: 120,
            right: 120,
            bottom: 120,
            x: 0,
            y: 0,
            toJSON: () => {},
        });

        // Click at center (60, 60) → distance ~0, azimuth ~0
        fireEvent.mouseDown(canvas, { clientX: 60, clientY: 60 });
        expect(onChange).toHaveBeenCalledTimes(1);
        // At center, distance should be ~0 and azimuth ~0.
        const [, distance] = onChange.mock.calls[0]!;
        expect(distance).toBeCloseTo(0, 1);
    });

    it('does not call onChange on mouseMove before mouseDown', () => {
        const onChange = vi.fn();
        const { container } = render(<SpatialPanner onChange={onChange} size={120} />);
        const canvas = container.querySelector('canvas')!;
        canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 120,
            height: 120,
            right: 120,
            bottom: 120,
            x: 0,
            y: 0,
            toJSON: () => {},
        });

        fireEvent.mouseMove(canvas, { clientX: 80, clientY: 80 });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('stops calling onChange after mouseUp', () => {
        const onChange = vi.fn();
        const { container } = render(<SpatialPanner onChange={onChange} size={120} />);
        const canvas = container.querySelector('canvas')!;
        canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 120,
            height: 120,
            right: 120,
            bottom: 120,
            x: 0,
            y: 0,
            toJSON: () => {},
        });

        fireEvent.mouseDown(canvas, { clientX: 60, clientY: 60 });
        fireEvent.mouseUp(canvas);
        fireEvent.mouseMove(canvas, { clientX: 80, clientY: 80 });
        // Only the mouseDown should have fired onChange, not the post-mouseUp move.
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

describe('SpatialPanner — keyboard operation', () => {
    it('ArrowUp raises aria-valuenow by the step and fires onChange', () => {
        const onChange = vi.fn();
        render(<SpatialPanner onChange={onChange} />);
        const slider = screen.getByRole('slider');
        expect(slider).toHaveAttribute('aria-valuenow', '0');

        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        expect(slider).toHaveAttribute('aria-valuenow', '15');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(15, 0.5);
    });

    it('ArrowDown lowers aria-valuenow and clamps at the -180 minimum', () => {
        render(<SpatialPanner azimuth={-175} />);
        const slider = screen.getByRole('slider');

        fireEvent.keyDown(slider, { key: 'ArrowDown' });
        expect(slider).toHaveAttribute('aria-valuenow', '-180');

        fireEvent.keyDown(slider, { key: 'ArrowDown' });
        expect(slider).toHaveAttribute('aria-valuenow', '-180');
    });

    it('non-arrow keys leave the value untouched', () => {
        render(<SpatialPanner azimuth={30} />);
        const slider = screen.getByRole('slider');

        fireEvent.keyDown(slider, { key: 'Enter' });
        expect(slider).toHaveAttribute('aria-valuenow', '30');
    });
});

describe('SpatialPanner — canvas dimensions', () => {
    it('canvas width and height match the size prop', () => {
        const { container } = render(<SpatialPanner size={100} />);
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('width')).toBe('100');
        expect(canvas?.getAttribute('height')).toBe('100');
    });
});

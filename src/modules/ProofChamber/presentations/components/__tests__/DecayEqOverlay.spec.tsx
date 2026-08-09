import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DecayEqOverlay } from '../DecayEqOverlay';

function mockRect(canvas: HTMLElement, w = 200, h = 60): void {
    canvas.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: w,
        height: h,
        right: w,
        bottom: h,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    });
}

describe('DecayEqOverlay', () => {
    it('should render', () => {
        const { container } = render(
            <DecayEqOverlay multipliers={[1, 1, 1, 1, 1, 1]} onChange={vi.fn()} width={200} height={60} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});

describe('DecayEqOverlay — canvas attributes', () => {
    it('sizes the canvas to the provided width and height', () => {
        const { container } = render(
            <DecayEqOverlay multipliers={[1, 1, 1, 1, 1, 1]} onChange={vi.fn()} width={300} height={100} />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.width).toBe(300);
        expect(canvas?.height).toBe(100);
    });

    it('renders a canvas with pointer-events auto', () => {
        const { container } = render(
            <DecayEqOverlay multipliers={[1, 1, 1, 1, 1, 1]} onChange={vi.fn()} width={200} height={60} />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('style')).toContain('pointer-events: auto');
    });
});

describe('DecayEqOverlay — drag interaction', () => {
    it('fires onChange with band index and clamped multiplier on pointer drag', () => {
        const onChange = vi.fn();
        const { container } = render(
            <DecayEqOverlay multipliers={[1, 1, 1, 1, 1, 1]} onChange={onChange} width={200} height={60} />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas, 200, 60);

        // BAND_FREQS[0] = 100Hz → freqToX(100, 200) ≈ 80.6
        // multToY(1, 60) = 30 (center)
        // Drag from center of band 0 toward top (y=10 → mult > 1)
        fireEvent.pointerDown(canvas, { clientX: 81, clientY: 30, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 81, clientY: 10, pointerId: 1 });

        expect(onChange).toHaveBeenCalled();
        const [bandIdx, mult] = onChange.mock.calls[0]!;
        expect(bandIdx).toBeGreaterThanOrEqual(0);
        expect(bandIdx).toBeLessThan(6);
        expect(mult).toBeGreaterThan(1); // Dragged up = higher multiplier
        expect(mult).toBeLessThanOrEqual(4.0); // Clamped to MAX_MULT
    });

    it('does not fire onChange on pointer move without prior pointer down', () => {
        const onChange = vi.fn();
        const { container } = render(
            <DecayEqOverlay multipliers={[1, 1, 1, 1, 1, 1]} onChange={onChange} width={200} height={60} />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas, 200, 60);

        fireEvent.pointerMove(canvas, { clientX: 81, clientY: 10, pointerId: 1 });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('refuses the drag while the live algorithm cannot hear the curve', () => {
        // The reverse engine has no recirculating path for a decay multiplier
        // to act on, so the panel hands the overlay `disabled` and the nodes
        // must stop moving. A curve that dragged and wrote would be the defect
        // #1539 opened on, one algorithm smaller.
        const onChange = vi.fn();
        const { container } = render(
            <DecayEqOverlay multipliers={[1, 1, 1, 1, 1, 1]} onChange={onChange} disabled width={200} height={60} />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas, 200, 60);

        fireEvent.pointerDown(canvas, { clientX: 81, clientY: 30, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 81, clientY: 10, pointerId: 1 });

        expect(onChange).not.toHaveBeenCalled();
        expect(canvas.getAttribute('aria-disabled')).toBe('true');
    });

    it('leaves the curve interactive when it is not disabled', () => {
        // The other direction, so a blanket refusal cannot satisfy the pair.
        const onChange = vi.fn();
        const { container } = render(
            <DecayEqOverlay multipliers={[1, 1, 1, 1, 1, 1]} onChange={onChange} width={200} height={60} />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas, 200, 60);

        fireEvent.pointerDown(canvas, { clientX: 81, clientY: 30, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 81, clientY: 10, pointerId: 1 });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(canvas.getAttribute('aria-disabled')).toBeNull();
    });

    it('clamps multiplier to MIN_MULT (0.25) when dragged to bottom', () => {
        const onChange = vi.fn();
        const { container } = render(
            <DecayEqOverlay multipliers={[1, 1, 1, 1, 1, 1]} onChange={onChange} width={200} height={60} />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas, 200, 60);

        // Drag band 0 all the way to bottom (y=60 → mult ≈ 0.25)
        fireEvent.pointerDown(canvas, { clientX: 81, clientY: 30, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 81, clientY: 60, pointerId: 1 });

        const [, mult] = onChange.mock.calls[0]!;
        expect(mult).toBeGreaterThanOrEqual(0.25);
        expect(mult).toBeLessThanOrEqual(0.5); // Near the floor
    });
});

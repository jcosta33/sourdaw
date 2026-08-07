import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SpectralBinEditor } from '../SpectralBinEditor';

function mockRect(canvas: HTMLElement): void {
    canvas.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 64,
        right: 100,
        bottom: 64,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    });
}

describe('SpectralBinEditor', () => {
    it('should render', () => {
        const { container } = render(
            <SpectralBinEditor
                width={100}
                height={64}
                numBins={8}
                binValues={Array.from({ length: 8 }, () => 0.5)}
                onBinValuesChange={vi.fn()}
                mode="gate"
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('re-syncs internal state when the controlled binValues prop changes', () => {
        const onBinValuesChange = vi.fn();
        const { container, rerender } = render(
            <SpectralBinEditor
                width={100}
                height={64}
                numBins={8}
                binValues={Array.from({ length: 8 }, () => 0.1)}
                onBinValuesChange={onBinValuesChange}
                mode="gate"
            />
        );
        rerender(
            <SpectralBinEditor
                width={100}
                height={64}
                numBins={8}
                binValues={Array.from({ length: 8 }, () => 0.9)}
                onBinValuesChange={onBinValuesChange}
                mode="gate"
            />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas);
        fireEvent.pointerDown(canvas, { clientX: 1, clientY: 0, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });
        const committed = onBinValuesChange.mock.calls.at(-1)![0] as number[];
        expect(committed[7]).toBeCloseTo(0.9, 5);
    });

    it('does not clobber an in-progress edit when the parent re-renders with a new but content-equal binValues array', () => {
        const onBinValuesChange = vi.fn();
        const { container, rerender } = render(
            <SpectralBinEditor
                width={100}
                height={64}
                numBins={8}
                binValues={[]}
                onBinValuesChange={onBinValuesChange}
                mode="gate"
            />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas);
        fireEvent.pointerDown(canvas, { clientX: 1, clientY: 0, pointerId: 1 });
        rerender(
            <SpectralBinEditor
                width={100}
                height={64}
                numBins={8}
                binValues={[]}
                onBinValuesChange={onBinValuesChange}
                mode="gate"
            />
        );
        fireEvent.pointerUp(canvas, { pointerId: 1 });
        const committed = onBinValuesChange.mock.calls.at(-1)![0] as number[];
        expect(committed[0]).toBeCloseTo(1, 2);
    });

    it('clears the drawing state on pointercancel', () => {
        const onBinValuesChange = vi.fn();
        const { container } = render(
            <SpectralBinEditor
                width={100}
                height={64}
                numBins={8}
                binValues={Array.from({ length: 8 }, () => 0.5)}
                onBinValuesChange={onBinValuesChange}
                mode="gate"
            />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas);
        fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
        fireEvent.pointerCancel(canvas, { pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 50, clientY: 30, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });
        expect(onBinValuesChange).not.toHaveBeenCalled();
    });
});

describe('SpectralBinEditor — canvas attributes and label', () => {
    it('sizes the canvas to the provided width and height', () => {
        const { container } = render(
            <SpectralBinEditor width={200} height={100} binValues={[]} onBinValuesChange={vi.fn()} mode="gate" />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.width).toBe(200);
        expect(canvas?.height).toBe(100);
    });

    it('shows "Spectral Gate" label when mode is gate', () => {
        const { container } = render(
            <SpectralBinEditor width={100} height={64} binValues={[]} onBinValuesChange={vi.fn()} mode="gate" />
        );
        expect(container.textContent).toContain('Spectral Gate');
    });

    it('shows "Spectral Blur" label when mode is blur', () => {
        const { container } = render(
            <SpectralBinEditor width={100} height={64} binValues={[]} onBinValuesChange={vi.fn()} mode="blur" />
        );
        expect(container.textContent).toContain('Spectral Blur');
    });
});

describe('SpectralBinEditor — painting interaction', () => {
    it('commits painted bin values via onBinValuesChange on pointerUp', () => {
        const onBinValuesChange = vi.fn();
        const { container } = render(
            <SpectralBinEditor
                width={100}
                height={64}
                numBins={8}
                binValues={Array.from({ length: 8 }, () => 0.5)}
                onBinValuesChange={onBinValuesChange}
                mode="gate"
            />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas);
        // Paint at x=1 (bin 0), y=0 (top → value ≈ 1)
        fireEvent.pointerDown(canvas, { clientX: 1, clientY: 0, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });
        expect(onBinValuesChange).toHaveBeenCalledTimes(1);
        const committed = onBinValuesChange.mock.calls[0]?.[0] as number[];
        expect(committed[0]).toBeGreaterThan(0.5);
    });

    it('paints neighboring bins with falloff during a brush stroke', () => {
        const onBinValuesChange = vi.fn();
        const { container } = render(
            <SpectralBinEditor
                width={100}
                height={64}
                numBins={8}
                binValues={Array.from({ length: 8 }, () => 0.5)}
                onBinValuesChange={onBinValuesChange}
                mode="gate"
            />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas);
        // Paint at x=25 (bin 2), y=0 (value ≈ 1)
        fireEvent.pointerDown(canvas, { clientX: 25, clientY: 0, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });
        const committed = onBinValuesChange.mock.calls[0]?.[0] as number[];
        // Bin 2 should be highest (direct hit)
        // Bins 1 and 3 should also increase (falloff neighbors)
        expect(committed[2]).toBeGreaterThan(committed[1]!);
        expect(committed[2]).toBeGreaterThan(committed[3]!);
        // Bins 1 and 3 should be higher than the original 0.5 baseline
        expect(committed[1]).toBeGreaterThan(0.5);
        expect(committed[3]).toBeGreaterThan(0.5);
    });
});

import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { GlutenCurve } from '../GlutenCurve';

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: (_prop: string, fallback: string) => fallback,
}));

describe('GlutenCurve', () => {
    it('should render a canvas', () => {
        const { container } = render(
            <GlutenCurve threshold={-18} ratio={3} knee={2} makeup={0} grDb={0} inputDb={-12} width={120} height={80} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('should not apply a grab cursor on pointer up when non-interactive', () => {
        const { container } = render(
            <GlutenCurve threshold={-18} ratio={3} knee={2} makeup={0} grDb={0} inputDb={-12} width={120} height={80} />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeTruthy();
        fireEvent.pointerDown(canvas as HTMLCanvasElement, { pointerId: 1 });
        fireEvent.pointerUp(canvas as HTMLCanvasElement, { pointerId: 1 });
        expect((canvas as HTMLCanvasElement).style.cursor).toBe('');
    });

    it('should apply a grab cursor on pointer up when interactive', () => {
        const { container } = render(
            <GlutenCurve
                threshold={-18}
                ratio={3}
                knee={2}
                makeup={0}
                grDb={0}
                inputDb={-12}
                width={120}
                height={80}
                onThresholdChange={() => {}}
            />
        );
        const canvas = container.querySelector('canvas') as HTMLCanvasElement;
        fireEvent.pointerDown(canvas, { pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });
        expect(canvas.style.cursor).toBe('grab');
    });

    it('should allocate backing store for width and height', async () => {
        const { container } = render(
            <GlutenCurve threshold={-18} ratio={3} knee={2} makeup={0} grDb={0} inputDb={-12} width={120} height={80} />
        );
        const canvas = container.querySelector('canvas');
        await vi.waitFor(() => {
            expect(canvas?.width).toBeGreaterThan(0);
            expect(canvas?.height).toBeGreaterThan(0);
        });
    });
});

describe('GlutenCurve — canvas attributes', () => {
    it('renders with role=img and aria-label', () => {
        const { container } = render(
            <GlutenCurve threshold={-18} ratio={3} knee={2} makeup={0} grDb={0} inputDb={-12} />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('role')).toBe('img');
        expect(canvas?.getAttribute('aria-label')).toBe('Gluten compressor transfer curve');
    });

    it('uses default width=340 and height=180 when not provided', () => {
        const { container } = render(
            <GlutenCurve threshold={-18} ratio={3} knee={2} makeup={0} grDb={0} inputDb={-12} />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.width).toBe(340);
        expect(canvas?.height).toBe(180);
    });

    it('shows grab cursor when interactive (onThresholdChange provided)', () => {
        const { container } = render(
            <GlutenCurve
                threshold={-18}
                ratio={3}
                knee={2}
                makeup={0}
                grDb={0}
                inputDb={-12}
                onThresholdChange={() => {}}
            />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.style.cursor).toBe('grab');
    });

    it('shows no cursor when non-interactive', () => {
        const { container } = render(
            <GlutenCurve threshold={-18} ratio={3} knee={2} makeup={0} grDb={0} inputDb={-12} />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.style.cursor).toBe('');
    });
});

describe('GlutenCurve — threshold drag interaction', () => {
    it('fires onThresholdChange with clamped dB value on drag', () => {
        const onThresholdChange = vi.fn();
        const { container } = render(
            <GlutenCurve
                threshold={-18}
                ratio={3}
                knee={2}
                makeup={0}
                grDb={0}
                inputDb={-12}
                width={340}
                height={180}
                onThresholdChange={onThresholdChange}
            />
        );
        const canvas = container.querySelector('canvas') as HTMLCanvasElement;
        canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 340,
            height: 180,
            right: 340,
            bottom: 180,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        fireEvent.pointerDown(canvas, { clientY: 50, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientY: 30, pointerId: 1 });

        expect(onThresholdChange).toHaveBeenCalledTimes(1);
        const value = onThresholdChange.mock.calls[0]?.[0];
        // yRatio = (30 - 10) / (180 - 20) = 0.125
        // db = 0 - 0.125 * (0 - (-60)) = -7.5
        expect(value).toBeCloseTo(-7.5, 1);
        expect(value).toBeGreaterThanOrEqual(-60);
        expect(value).toBeLessThanOrEqual(0);
    });

    it('changes cursor to grabbing during active drag', () => {
        const { container } = render(
            <GlutenCurve
                threshold={-18}
                ratio={3}
                knee={2}
                makeup={0}
                grDb={0}
                inputDb={-12}
                onThresholdChange={() => {}}
            />
        );
        const canvas = container.querySelector('canvas') as HTMLCanvasElement;
        fireEvent.pointerDown(canvas, { pointerId: 1 });
        expect(canvas.style.cursor).toBe('grabbing');
    });
});

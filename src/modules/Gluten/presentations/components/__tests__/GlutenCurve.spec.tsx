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
        // No onThresholdChange / onRatioChange → render leaves cursor undefined.
        const { container } = render(
            <GlutenCurve threshold={-18} ratio={3} knee={2} makeup={0} grDb={0} inputDb={-12} width={120} height={80} />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeTruthy();

        fireEvent.pointerDown(canvas as HTMLCanvasElement, { pointerId: 1 });
        fireEvent.pointerUp(canvas as HTMLCanvasElement, { pointerId: 1 });

        // A non-interactive canvas must stay cursorless after a down/up cycle.
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

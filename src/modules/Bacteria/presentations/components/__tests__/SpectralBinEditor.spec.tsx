import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SpectralBinEditor } from '../SpectralBinEditor';

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

    // Regression: a cancelled gesture clears the drawing flag so a later move does
    // not keep painting bins and pointerUp does not commit.
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
        canvas.getBoundingClientRect = () =>
            ({
                left: 0,
                top: 0,
                width: 100,
                height: 64,
                right: 100,
                bottom: 64,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;

        fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
        fireEvent.pointerCancel(canvas, { pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 50, clientY: 30, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        expect(onBinValuesChange).not.toHaveBeenCalled();
    });
});

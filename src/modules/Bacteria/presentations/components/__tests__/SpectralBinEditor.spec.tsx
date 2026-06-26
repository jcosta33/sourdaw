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

    // Regression: the local state re-syncs when the controlled binValues prop
    // changes. Previously the init-once useState never re-synced, so after the
    // parent swapped in a new baseline an edit would commit the STALE values for
    // every untouched bin.
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

        // Parent swaps in a new baseline (all 0.9) with the same bin count.
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

        // Edit only bin 0 (far left); commit on pointerUp.
        fireEvent.pointerDown(canvas, { clientX: 1, clientY: 0, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        const committed = onBinValuesChange.mock.calls.at(-1)![0] as number[];
        // An untouched far-right bin must reflect the NEW baseline (0.9), not the
        // stale 0.1 captured at mount.
        expect(committed[7]).toBeCloseTo(0.9, 5);
    });

    // Regression: an in-progress edit must survive a parent re-render that passes a
    // fresh-but-content-equal `binValues` literal. The live mount passes
    // `binValues={[]}` — a new array identity every render — so a re-sync keyed on
    // array identity would re-fire on the re-render and clobber the half-drawn edit.
    // Keying the re-sync on the content signature (numBins + values) leaves it intact.
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

        // Begin drawing and edit bin 0 near the top (value ≈ 1), without committing.
        fireEvent.pointerDown(canvas, { clientX: 1, clientY: 0, pointerId: 1 });

        // Parent re-renders with a BRAND-NEW empty literal (same content as before).
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

        // Commit the gesture.
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        const committed = onBinValuesChange.mock.calls.at(-1)![0] as number[];
        // The edited bin must retain the drawn value (≈1), not be reset to 0.5.
        expect(committed[0]).toBeCloseTo(1, 2);
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

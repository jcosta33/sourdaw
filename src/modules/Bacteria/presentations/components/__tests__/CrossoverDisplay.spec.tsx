import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { CrossoverDisplay } from '../CrossoverDisplay';

// log10 frequency → x position, mirroring the component's freqToX.
function freqToX(freq: number, width: number): number {
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    return ((Math.log10(freq) - minLog) / (maxLog - minLog)) * width;
}

// A capturing ResizeObserver: records callbacks so a test can drive a resize
// (the jsdom default mock never fires its callback).
type ResizeCb = (entries: Array<{ contentRect: { width: number } }>) => void;
const observers: Array<{ cb: ResizeCb; el: Element | null }> = [];

function emitResize(width: number): void {
    act(() => {
        for (const o of observers) {
            o.cb([{ contentRect: { width } }]);
        }
    });
}

describe('CrossoverDisplay', () => {
    beforeEach(() => {
        observers.length = 0;
        globalThis.ResizeObserver = class {
            private cb: ResizeCb;
            constructor(cb: ResizeCb) {
                this.cb = cb;
            }
            observe(el: Element): void {
                observers.push({ cb: this.cb, el });
            }
            unobserve(): void {}
            disconnect(): void {}
        } as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should render', () => {
        render(
            <CrossoverDisplay
                bandCount={2}
                crossoverFreqs={[500, 2000]}
                crossoverMode="lr4"
                activeBand={0}
                onBandSelect={vi.fn()}
                onCrossoverChange={vi.fn()}
            />
        );
        expect(screen.getByText('lr4')).toBeInTheDocument();
    });

    // Regression: layout x-positions are derived from ResizeObserver-tracked width
    // state, not from reading containerRef.clientWidth during render. The old code
    // never re-rendered on resize, so handle/band positions stayed stale; the new
    // code repositions when the observer reports a new width.
    it('repositions the crossover handle when the container is resized', () => {
        const { container } = render(
            <CrossoverDisplay
                bandCount={2}
                crossoverFreqs={[500]}
                crossoverMode="lr4"
                activeBand={0}
                onBandSelect={vi.fn()}
                onCrossoverChange={vi.fn()}
            />
        );

        const handle = (): HTMLElement => container.querySelector('.cursor-ew-resize') as HTMLElement;
        expect(handle()).toBeTruthy();

        // Resize the container to a concrete measured width.
        emitResize(320);
        expect(parseFloat(handle().style.left)).toBeCloseTo(freqToX(500, 320) - 4, 1);

        // A second, different resize must move the handle again (it tracks state,
        // it is not pinned to a one-time/render-time read).
        emitResize(640);
        expect(parseFloat(handle().style.left)).toBeCloseTo(freqToX(500, 640) - 4, 1);
    });

    // Regression: a cancelled drag clears the active handle index so a later move
    // does not keep changing the crossover frequency.
    it('clears the active drag on pointercancel', () => {
        const onCrossoverChange = vi.fn();

        const { container } = render(
            <CrossoverDisplay
                bandCount={2}
                crossoverFreqs={[500]}
                crossoverMode="lr4"
                activeBand={0}
                onBandSelect={vi.fn()}
                onCrossoverChange={onCrossoverChange}
            />
        );
        const root = container.firstChild as HTMLElement;
        root.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 400,
            height: 80,
            right: 400,
            bottom: 80,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        const handle = container.querySelector('.cursor-ew-resize') as HTMLElement;
        fireEvent.pointerDown(handle, { clientX: 100, clientY: 10, pointerId: 1 });
        fireEvent.pointerCancel(root, { pointerId: 1 });
        onCrossoverChange.mockClear();
        // Move after cancel must not change the crossover frequency.
        fireEvent.pointerMove(root, { clientX: 200, clientY: 10, pointerId: 1 });

        expect(onCrossoverChange).not.toHaveBeenCalled();
    });
});

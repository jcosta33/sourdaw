import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { CrossoverDisplay } from '../CrossoverDisplay';

function freqToX(freq: number, width: number): number {
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    return ((Math.log10(freq) - minLog) / (maxLog - minLog)) * width;
}

type ResizeCb = (entries: Array<{ contentRect: { width: number } }>) => void;
const observers: Array<{ cb: ResizeCb; el: Element | null }> = [];

function emitResize(width: number): void {
    act(() => {
        for (const o of observers) {
            o.cb([{ contentRect: { width } }]);
        }
    });
}

function mockRect(el: HTMLElement, width = 400): void {
    el.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width,
        height: 80,
        right: width,
        bottom: 80,
        x: 0,
        y: 0,
        toJSON: () => ({}),
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
        expect(screen.getByText('lr4')).toBeTruthy();
    });

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
        emitResize(320);
        expect(parseFloat(handle().style.left)).toBeCloseTo(freqToX(500, 320) - 4, 1);
        emitResize(640);
        expect(parseFloat(handle().style.left)).toBeCloseTo(freqToX(500, 640) - 4, 1);
    });

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
        mockRect(root);
        const handle = container.querySelector('.cursor-ew-resize') as HTMLElement;
        fireEvent.pointerDown(handle, { clientX: 100, clientY: 10, pointerId: 1 });
        fireEvent.pointerCancel(root, { pointerId: 1 });
        onCrossoverChange.mockClear();
        fireEvent.pointerMove(root, { clientX: 200, clientY: 10, pointerId: 1 });
        expect(onCrossoverChange).not.toHaveBeenCalled();
    });
});

describe('CrossoverDisplay — band labels and mode', () => {
    it('shows band number labels for each band', () => {
        render(
            <CrossoverDisplay
                bandCount={3}
                crossoverFreqs={[500, 2000]}
                crossoverMode="lr4"
                activeBand={1}
                onBandSelect={vi.fn()}
                onCrossoverChange={vi.fn()}
            />
        );
        expect(screen.getByText('1')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
    });

    it('shows the crossover mode indicator', () => {
        render(
            <CrossoverDisplay
                bandCount={2}
                crossoverFreqs={[500]}
                crossoverMode="linear-phase"
                activeBand={0}
                onBandSelect={vi.fn()}
                onCrossoverChange={vi.fn()}
            />
        );
        expect(screen.getByText('linear-phase')).toBeTruthy();
    });
});

describe('CrossoverDisplay — drag and band click', () => {
    it('commits crossover frequency when a handle is dragged', () => {
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
        mockRect(root, 400);
        const handle = container.querySelector('.cursor-ew-resize') as HTMLElement;
        fireEvent.pointerDown(handle, { clientX: 100, clientY: 10, pointerId: 1 });
        fireEvent.pointerMove(root, { clientX: 200, clientY: 10, pointerId: 1 });
        expect(onCrossoverChange).toHaveBeenCalledTimes(1);
        const [bandIdx, freq] = onCrossoverChange.mock.calls[0]!;
        expect(bandIdx).toBe(0);
        expect(freq).toBeGreaterThan(20);
        expect(freq).toBeLessThanOrEqual(20000);
    });

    it('selects a band when the display area is clicked', () => {
        const onBandSelect = vi.fn();
        const { container } = render(
            <CrossoverDisplay
                bandCount={2}
                crossoverFreqs={[500]}
                crossoverMode="lr4"
                activeBand={0}
                onBandSelect={onBandSelect}
                onCrossoverChange={vi.fn()}
            />
        );
        const root = container.firstChild as HTMLElement;
        mockRect(root, 400);
        // Click at x=300 (high freq area → band 1)
        fireEvent.pointerDown(root, { clientX: 300, clientY: 10, pointerId: 1 });
        expect(onBandSelect).toHaveBeenCalledTimes(1);
        expect(onBandSelect.mock.calls[0]?.[0]).toBe(1);
    });
});

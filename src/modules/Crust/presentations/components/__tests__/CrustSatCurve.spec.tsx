import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type CrustSatAlgorithm } from '../../../models/CrustPatch';
import { CrustSatCurve } from '../CrustSatCurve';

describe('CrustSatCurve', () => {
    it('should render', () => {
        const { container } = render(<CrustSatCurve algorithm="soft" drive={3} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});

describe('CrustSatCurve — canvas attributes', () => {
    it('renders an 80x80 canvas', () => {
        const { container } = render(<CrustSatCurve algorithm="soft" drive={3} />);
        const canvas = container.querySelector('canvas');
        expect(canvas?.width).toBe(80);
        expect(canvas?.height).toBe(80);
    });

    it('uses the algorithm name in the aria-label', () => {
        const { container } = render(<CrustSatCurve algorithm="tape" drive={6} />);
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('aria-label')).toBe('Saturation transfer curve: tape');
    });

    it('updates aria-label when algorithm changes', () => {
        const { container, rerender } = render(<CrustSatCurve algorithm="soft" drive={3} />);
        expect(container.querySelector('canvas')?.getAttribute('aria-label')).toContain('soft');
        rerender(<CrustSatCurve algorithm="fold" drive={9} />);
        expect(container.querySelector('canvas')?.getAttribute('aria-label')).toContain('fold');
    });
});

describe('CrustSatCurve — transfer-curve exhaustiveness', () => {
    let yCoords: number[];
    let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

    beforeEach(() => {
        yCoords = [];
        originalGetContext = HTMLCanvasElement.prototype.getContext;
        const recordY = (_x: number, y: number): void => {
            yCoords.push(y);
        };
        const recordingCtx = {
            canvas: {} as HTMLCanvasElement,
            clearRect: (): void => {},
            fillRect: (): void => {},
            beginPath: (): void => {},
            moveTo: recordY,
            lineTo: recordY,
            stroke: (): void => {},
            setLineDash: (): void => {},
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
        } as unknown as CanvasRenderingContext2D;
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
            this: HTMLCanvasElement,
            contextId: string
        ) {
            if (contextId === '2d') {
                (recordingCtx as { canvas: HTMLCanvasElement }).canvas = this;
                return recordingCtx;
            }
            return null;
        } as typeof HTMLCanvasElement.prototype.getContext);
    });

    afterEach(() => {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
    });

    it('plots finite coordinates for every known algorithm', () => {
        const algos: CrustSatAlgorithm[] = ['soft', 'hard', 'tape', 'tube', 'fold'];
        for (const algo of algos) {
            yCoords = [];
            const { unmount } = render(<CrustSatCurve algorithm={algo} drive={9} />);
            expect(yCoords.length).toBeGreaterThan(0);
            expect(yCoords.every((y) => Number.isFinite(y))).toBe(true);
            unmount();
        }
    });

    it('falls back to a finite identity curve for an unknown algorithm rather than plotting NaN', () => {
        const unknownAlgo = 'wavefold-v2' as unknown as CrustSatAlgorithm;
        render(<CrustSatCurve algorithm={unknownAlgo} drive={9} />);
        expect(yCoords.length).toBeGreaterThan(0);
        expect(yCoords.every((y) => Number.isFinite(y))).toBe(true);
    });
});

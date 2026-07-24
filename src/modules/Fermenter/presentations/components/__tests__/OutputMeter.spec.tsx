import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect } from 'vitest';

import { DEFAULT_FERMENTER_STATE, fermenterStore } from '../../../stores/fermenterStore';
import { OutputMeter } from '../OutputMeter';

const DEVICE = 'device-meter';

function setPeaks(peakL: number, peakR: number): void {
    fermenterStore.set({
        [DEVICE]: { ...DEFAULT_FERMENTER_STATE, peakL, peakR },
    });
}

/**
 * Independent re-derivation of the OutputMeter DSP math, from the audio spec:
 *  - dB        = v < 0.0001 ? -60 : 20·log10(v)
 *  - percent   = clamp((dB − (−60)) / (6 − (−60)), 0, 1) = clamp((dB + 60)/66, 0, 1)
 *  - bar height (px) = max(1, percent · meterHeight)
 *  - opacity   = percent < 0.01 ? 0.2 : 1
 */
function expectedPercent(peak: number): number {
    const db = peak < 0.0001 ? -60 : 20 * Math.log10(peak);
    return Math.max(0, Math.min(1, (db + 60) / 66));
}

function barStyle(side: 'L' | 'R'): { height: string; opacity: number } {
    const label = side === 'L' ? 'L' : 'R';
    // The bar is the div preceding the L/R label.
    const labelEl = screen.getByText(label);
    const bar = labelEl.parentElement!.querySelector('div') as HTMLElement;
    const style = bar.style;
    return { height: style.height, opacity: Number(style.opacity) };
}

describe('OutputMeter', () => {
    beforeEach(() => {
        fermenterStore.set({});
    });

    it('renders L and R channel labels', () => {
        render(<OutputMeter deviceId={DEVICE} height={48} />);
        expect(screen.getByText('L')).toBeInTheDocument();
        expect(screen.getByText('R')).toBeInTheDocument();
    });

    it('renders a flat, dimmed bar for a silent channel (peak ≈ 0)', () => {
        const height = 48;
        setPeaks(0, 0);
        render(<OutputMeter deviceId={DEVICE} height={height} />);

        const l = barStyle('L');
        // Silent → percent 0 → height floored to 1px, opacity dimmed to 0.2.
        expect(l.height).toBe('1px');
        expect(l.opacity).toBe(0.2);
    });

    it('maps a mid-level peak to the proportional bar height and full opacity', () => {
        const height = 80;
        const peak = 0.5; // dB ≈ −6.02 → peach zone, full opacity
        setPeaks(peak, peak);
        render(<OutputMeter deviceId={DEVICE} height={height} />);

        const pct = expectedPercent(peak);
        const l = barStyle('L');
        expect(l.height).toBe(`${Math.max(1, pct * height)}px`);
        expect(l.opacity).toBe(1);
    });

    it('reflects independent L and R peak levels in their respective bars', () => {
        const height = 100;
        setPeaks(1.0, 0.25);
        render(<OutputMeter deviceId={DEVICE} height={height} />);

        const lPct = expectedPercent(1.0);
        const rPct = expectedPercent(0.25);
        expect(barStyle('L').height).toBe(`${Math.max(1, lPct * height)}px`);
        expect(barStyle('R').height).toBe(`${Math.max(1, rPct * height)}px`);
    });

    it('clamps an over-unity peak to 100% bar height', () => {
        const height = 50;
        // peak > 1 → dB > 0 → percent clamps to 1 → full height.
        setPeaks(2.0, 2.0);
        render(<OutputMeter deviceId={DEVICE} height={height} />);

        expect(barStyle('L').height).toBe(`${height}px`);
        expect(barStyle('R').height).toBe(`${height}px`);
    });
});

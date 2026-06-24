import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH, type ProofPatch } from '../../../models/ProofPatch';
import {
    ProofEqCurve,
    eqBandMag,
    bandUsesGain,
    EQ_PEAK,
    EQ_LOW_SHELF,
    EQ_HIGH_SHELF,
    EQ_HIGH_PASS,
    EQ_LOW_PASS,
} from '../ProofEqCurve';

describe('ProofEqCurve', () => {
    it('should render', () => {
        const { container } = render(
            <ProofEqCurve
                patch={DEFAULT_PATCH}
                width={200}
                height={100}
                onPatchChange={vi.fn()}
                onSendParam={vi.fn()}
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    describe('eqBandMag — filter magnitude responses', () => {
        const Q = 0.707;

        it('peaking band peaks at its centre frequency and is flat far away', () => {
            // +6 dB peak at 1 kHz: full boost at fc, near zero an octave-decade out.
            expect(eqBandMag(EQ_PEAK, 1000, 1000, 6, 1)).toBeCloseTo(6, 1);
            expect(Math.abs(eqBandMag(EQ_PEAK, 50, 1000, 6, 1))).toBeLessThan(0.5);
            expect(Math.abs(eqBandMag(EQ_PEAK, 18000, 1000, 6, 1))).toBeLessThan(0.5);
            // Unity gain is perfectly flat everywhere.
            expect(eqBandMag(EQ_PEAK, 1000, 1000, 0, 1)).toBe(0);
        });

        it('low shelf boosts the low band and leaves the high band flat (a shelf, not a bump)', () => {
            const low = eqBandMag(EQ_LOW_SHELF, 20, 80, 6, Q);
            const high = eqBandMag(EQ_LOW_SHELF, 18000, 80, 6, Q);
            // Shelf plateau near the boost amount at low frequencies.
            expect(low).toBeGreaterThan(5);
            // High band returns to unity — NOT cut. A peaking formula would dip here.
            expect(Math.abs(high)).toBeLessThan(0.5);
            expect(high).toBeGreaterThan(-0.5);
        });

        it('high shelf boosts the high band and leaves the low band flat', () => {
            const high = eqBandMag(EQ_HIGH_SHELF, 18000, 12000, 6, Q);
            const low = eqBandMag(EQ_HIGH_SHELF, 50, 12000, 6, Q);
            expect(high).toBeGreaterThan(5);
            expect(Math.abs(low)).toBeLessThan(0.5);
            expect(low).toBeGreaterThan(-0.5);
        });

        it('high pass rolls off below cutoff, passes above, and is ~-3 dB at the corner', () => {
            const cutoff = 100;
            expect(eqBandMag(EQ_HIGH_PASS, cutoff, cutoff, 0, Q)).toBeCloseTo(-3, 0);
            // Passband is flat well above cutoff.
            expect(Math.abs(eqBandMag(EQ_HIGH_PASS, 2000, cutoff, 0, Q))).toBeLessThan(0.5);
            // Stopband is strongly attenuated well below cutoff — a real rolloff,
            // not the flat 0 dB the old code drew for HP bands.
            expect(eqBandMag(EQ_HIGH_PASS, 25, cutoff, 0, Q)).toBeLessThan(-15);
        });

        it('low pass passes below cutoff, rolls off above, and is ~-3 dB at the corner', () => {
            const cutoff = 18000;
            expect(eqBandMag(EQ_LOW_PASS, cutoff, cutoff, 0, Q)).toBeCloseTo(-3, 0);
            expect(Math.abs(eqBandMag(EQ_LOW_PASS, 1000, cutoff, 0, Q))).toBeLessThan(0.5);
        });
    });

    describe('bandUsesGain', () => {
        it('is true for peak and shelf bands, false for HP/LP cutoff bands', () => {
            expect(bandUsesGain(EQ_PEAK)).toBe(true);
            expect(bandUsesGain(EQ_LOW_SHELF)).toBe(true);
            expect(bandUsesGain(EQ_HIGH_SHELF)).toBe(true);
            expect(bandUsesGain(EQ_HIGH_PASS)).toBe(false);
            expect(bandUsesGain(EQ_LOW_PASS)).toBe(false);
        });
    });

    describe('vertical drag on HP/LP bands', () => {
        // Build a patch whose first band is an enabled high-pass at 30 Hz.
        const hpPatch: ProofPatch = {
            ...DEFAULT_PATCH,
            eqBands: DEFAULT_PATCH.eqBands.map((b, i) =>
                i === 0 ? { ...b, enabled: true, type: EQ_HIGH_PASS, freq: 30, gain: 0, q: 0.707 } : b
            ),
        };

        // The HP band-0 dot is drawn on the curve at the cutoff. With width=200,
        // height=100 that lands near (11.7, 58.4) in canvas pixels; jsdom's
        // getBoundingClientRect is all-zero so client coords map 1:1 to canvas coords.
        const DOT_X = 11.7;
        const DOT_Y = 58.4;

        const renderHp = () => {
            const onPatchChange = vi.fn();
            const onSendParam = vi.fn();
            const { container } = render(
                <ProofEqCurve
                    patch={hpPatch}
                    width={200}
                    height={100}
                    onPatchChange={onPatchChange}
                    onSendParam={onSendParam}
                />
            );
            const canvas = container.querySelector('canvas')!;
            return { canvas, onPatchChange, onSendParam };
        };

        it('does not write gain when an HP band is dragged vertically', () => {
            const { canvas, onPatchChange, onSendParam } = renderHp();

            // Grab the HP dot, then drag straight down (toward more negative gain).
            fireEvent.pointerDown(canvas, { clientX: DOT_X, clientY: DOT_Y, pointerId: 1 });
            fireEvent.pointerMove(canvas, { clientX: DOT_X, clientY: 95, pointerId: 1 });

            // The drag must have been picked up (frequency param still flows).
            expect(onPatchChange).toHaveBeenCalled();
            expect(onSendParam).toHaveBeenCalledWith('eq_band0_freq', expect.any(Number));

            // The gain axis is suppressed for HP: no gain param, and gain stays 0.
            const gainCalls = onSendParam.mock.calls.filter(([name]) => name === 'eq_band0_gain');
            expect(gainCalls).toEqual([]);
            const patchUpdates = onPatchChange.mock.calls as Array<[Partial<ProofPatch>]>;
            for (const [partial] of patchUpdates) {
                expect(partial.eqBands?.[0]?.gain).toBe(0);
            }
        });

        it('still writes gain when a peak/shelf band is dragged vertically', () => {
            // Band 2 of DEFAULT_PATCH is an enabled peak at 250 Hz — gain must move.
            const onPatchChange = vi.fn();
            const onSendParam = vi.fn();
            const { container } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    onPatchChange={onPatchChange}
                    onSendParam={onSendParam}
                />
            );
            const canvas = container.querySelector('canvas')!;
            expect(DEFAULT_PATCH.eqBands[2]!.type).toBe(EQ_PEAK);

            // Peak band 2 dot: x at 250 Hz, y at 0 dB (= height/2 = 50).
            const PEAK_X = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 200;
            fireEvent.pointerDown(canvas, { clientX: PEAK_X, clientY: 50, pointerId: 2 });
            fireEvent.pointerMove(canvas, { clientX: PEAK_X, clientY: 20, pointerId: 2 });

            const gainCalls = onSendParam.mock.calls.filter(([name]) => name === 'eq_band2_gain');
            expect(gainCalls.length).toBeGreaterThan(0);
            // Dragging up from centre yields a positive gain.
            expect(gainCalls.at(-1)![1]).toBeGreaterThan(0);
        });
    });
});

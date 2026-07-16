import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH, type ProofPatch, type ProofPatchEdit } from '../../../models/ProofPatch';
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

type PointerCaptureSpy = {
    capturedPointerId: number | null;
    events: string[];
};

const installPointerCaptureSpy = (element: HTMLElement): PointerCaptureSpy => {
    const state: PointerCaptureSpy = { capturedPointerId: null, events: [] };
    Object.defineProperty(element, 'setPointerCapture', {
        configurable: true,
        value: vi.fn((pointerId: number) => {
            state.capturedPointerId = pointerId;
            state.events.push(`set:${pointerId}`);
        }),
    });
    Object.defineProperty(element, 'releasePointerCapture', {
        configurable: true,
        value: vi.fn((pointerId: number) => {
            if (state.capturedPointerId === pointerId) {
                state.capturedPointerId = null;
            }
            state.events.push(`release:${pointerId}`);
        }),
    });
    return state;
};

const getCanvas = (container: HTMLElement): HTMLCanvasElement => {
    const canvas = container.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
        throw new TypeError('Expected a ProofEqCurve canvas');
    }
    installPointerCaptureSpy(canvas);
    return canvas;
};

const setDocumentVisibility = (state: DocumentVisibilityState): void => {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: state,
    });
};

describe('ProofEqCurve', () => {
    it('should render', () => {
        const { container } = render(
            <ProofEqCurve patch={DEFAULT_PATCH} width={200} height={100} gestureOwner={0} onPatchChange={vi.fn()} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    describe('eqBandMag — filter magnitude responses', () => {
        const Q = 0.707;

        it('peaking band peaks at its centre frequency and is flat far away', () => {
            // +6 dB peak at 1 kHz: full boost at fc, near zero an octave-decade out.
            expect(eqBandMag({ type: EQ_PEAK, f: 1000, fc: 1000, gainDb: 6, Q: 1 })).toBeCloseTo(6, 1);
            expect(Math.abs(eqBandMag({ type: EQ_PEAK, f: 50, fc: 1000, gainDb: 6, Q: 1 }))).toBeLessThan(0.5);
            expect(Math.abs(eqBandMag({ type: EQ_PEAK, f: 18000, fc: 1000, gainDb: 6, Q: 1 }))).toBeLessThan(0.5);
            // Unity gain is perfectly flat everywhere.
            expect(eqBandMag({ type: EQ_PEAK, f: 1000, fc: 1000, gainDb: 0, Q: 1 })).toBe(0);
        });

        it('low shelf boosts the low band and leaves the high band flat (a shelf, not a bump)', () => {
            const low = eqBandMag({ type: EQ_LOW_SHELF, f: 20, fc: 80, gainDb: 6, Q });
            const high = eqBandMag({ type: EQ_LOW_SHELF, f: 18000, fc: 80, gainDb: 6, Q });
            // Shelf plateau near the boost amount at low frequencies.
            expect(low).toBeGreaterThan(5);
            // High band returns to unity — NOT cut. A peaking formula would dip here.
            expect(Math.abs(high)).toBeLessThan(0.5);
            expect(high).toBeGreaterThan(-0.5);
        });

        it('high shelf boosts the high band and leaves the low band flat', () => {
            const high = eqBandMag({ type: EQ_HIGH_SHELF, f: 18000, fc: 12000, gainDb: 6, Q });
            const low = eqBandMag({ type: EQ_HIGH_SHELF, f: 50, fc: 12000, gainDb: 6, Q });
            expect(high).toBeGreaterThan(5);
            expect(Math.abs(low)).toBeLessThan(0.5);
            expect(low).toBeGreaterThan(-0.5);
        });

        it('high pass rolls off below cutoff, passes above, and is ~-3 dB at the corner', () => {
            const cutoff = 100;
            expect(eqBandMag({ type: EQ_HIGH_PASS, f: cutoff, fc: cutoff, gainDb: 0, Q })).toBeCloseTo(-3, 0);
            // Passband is flat well above cutoff.
            expect(Math.abs(eqBandMag({ type: EQ_HIGH_PASS, f: 2000, fc: cutoff, gainDb: 0, Q }))).toBeLessThan(0.5);
            // Stopband is strongly attenuated well below cutoff — a real rolloff,
            // not the flat 0 dB the old code drew for HP bands.
            expect(eqBandMag({ type: EQ_HIGH_PASS, f: 25, fc: cutoff, gainDb: 0, Q })).toBeLessThan(-15);
        });

        it('low pass passes below cutoff, rolls off above, and is ~-3 dB at the corner', () => {
            const cutoff = 18000;
            expect(eqBandMag({ type: EQ_LOW_PASS, f: cutoff, fc: cutoff, gainDb: 0, Q })).toBeCloseTo(-3, 0);
            expect(Math.abs(eqBandMag({ type: EQ_LOW_PASS, f: 1000, fc: cutoff, gainDb: 0, Q }))).toBeLessThan(0.5);
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
            const { container } = render(
                <ProofEqCurve patch={hpPatch} width={200} height={100} gestureOwner={0} onPatchChange={onPatchChange} />
            );
            const canvas = getCanvas(container);
            return { canvas, onPatchChange };
        };

        it('does not emit an edit when an HP band is dragged only vertically', () => {
            const { canvas, onPatchChange } = renderHp();

            // Grab the HP dot, then drag straight down (toward more negative gain).
            fireEvent.pointerDown(canvas, { clientX: DOT_X, clientY: DOT_Y, pointerId: 1 });
            fireEvent.pointerMove(canvas, { clientX: DOT_X, clientY: 95, pointerId: 1 });

            expect(onPatchChange).not.toHaveBeenCalled();
        });

        it('still writes gain when a peak/shelf band is dragged vertically', () => {
            // Band 2 of DEFAULT_PATCH is an enabled peak at 250 Hz — gain must move.
            const onPatchChange = vi.fn();
            const { container } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={onPatchChange}
                />
            );
            const canvas = getCanvas(container);
            expect(DEFAULT_PATCH.eqBands[2]!.type).toBe(EQ_PEAK);

            // Peak band 2 dot: x at 250 Hz, y at 0 dB (= height/2 = 50).
            const PEAK_X = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 200;
            fireEvent.pointerDown(canvas, { clientX: PEAK_X, clientY: 50, pointerId: 2 });
            fireEvent.pointerMove(canvas, { clientX: PEAK_X, clientY: 20, pointerId: 2 });

            // Dragging up from centre yields a positive gain.
            const patchUpdates = onPatchChange.mock.calls as Array<[ProofPatchEdit]>;
            const lastEdit = patchUpdates.at(-1)?.[0];
            expect(lastEdit?.key).toBe('eqBands');
            if (lastEdit?.key === 'eqBands') {
                expect(lastEdit.value[2]?.gain).toBeGreaterThan(0);
            }
        });

        it('emits exact transient domain params during drag and one persistence-only commit', () => {
            const onPatchChange = vi.fn();
            const { container } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={onPatchChange}
                />
            );
            const canvas = getCanvas(container);
            const peakX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 200;

            fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 50, pointerId: 3 });
            fireEvent.pointerMove(canvas, { clientX: peakX + 10, clientY: 20, pointerId: 3 });
            fireEvent.pointerUp(canvas, { pointerId: 3 });

            expect(onPatchChange).toHaveBeenCalledTimes(2);
            expect(onPatchChange.mock.calls[0]?.[0]).toMatchObject({
                key: 'eqBands',
                isTransient: true,
                changedParams: [
                    { bandIndex: 2, field: 'freq' },
                    { bandIndex: 2, field: 'gain' },
                ],
            });
            expect(onPatchChange.mock.calls[1]?.[0]).toMatchObject({
                key: 'eqBands',
                isTransient: false,
                changedParams: [
                    { bandIndex: 2, field: 'freq' },
                    { bandIndex: 2, field: 'gain' },
                ],
            });
        });

        it('finalizes an accepted transient drag when unmounted', () => {
            const onPatchChange = vi.fn();
            const { container, unmount } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={onPatchChange}
                />
            );
            const canvas = getCanvas(container);
            const peakX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 200;

            fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 50, pointerId: 10 });
            fireEvent.pointerMove(canvas, { clientX: peakX + 10, clientY: 20, pointerId: 10 });

            const transientEdit = onPatchChange.mock.calls.at(-1)?.[0] as ProofPatchEdit;
            expect(transientEdit.isTransient).toBe(true);

            unmount();

            expect(onPatchChange.mock.calls).toHaveLength(2);
            expect(onPatchChange.mock.calls[1]?.[0]).toMatchObject({
                key: 'eqBands',
                value: transientEdit.value,
                changedParams: [
                    { bandIndex: 2, field: 'freq' },
                    { bandIndex: 2, field: 'gain' },
                ],
                isTransient: false,
            });
        });

        it('uses the latest owner callback and accepted edit during teardown', () => {
            const initialOnPatchChange = vi.fn<(edit: ProofPatchEdit) => void>();
            const latestOnPatchChange = vi.fn<(edit: ProofPatchEdit) => void>();
            const { container, rerender, unmount } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={initialOnPatchChange}
                />
            );
            const canvas = getCanvas(container);
            const peakX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 200;

            fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 50, pointerId: 11 });
            fireEvent.pointerMove(canvas, { clientX: peakX + 5, clientY: 30, pointerId: 11 });
            fireEvent.pointerMove(canvas, { clientX: peakX + 15, clientY: 20, pointerId: 11 });

            const latestTransientEdit = initialOnPatchChange.mock.calls.at(-1)?.[0];
            if (!latestTransientEdit || latestTransientEdit.key !== 'eqBands') {
                throw new Error('Expected the latest accepted EQ transient edit');
            }
            rerender(
                <ProofEqCurve
                    patch={{
                        ...DEFAULT_PATCH,
                        eqBands: latestTransientEdit.value.map((band) => ({ ...band })),
                    }}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={latestOnPatchChange}
                />
            );

            unmount();

            expect(initialOnPatchChange).toHaveBeenCalledTimes(2);
            expect(latestOnPatchChange).toHaveBeenCalledWith({
                key: 'eqBands',
                value: latestTransientEdit.value,
                changedParams: [
                    { bandIndex: 2, field: 'freq' },
                    { bandIndex: 2, field: 'gain' },
                ],
                isTransient: false,
            });
        });

        it('does not finalize twice when pointerup precedes unmount', () => {
            const onPatchChange = vi.fn();
            const { container, unmount } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={onPatchChange}
                />
            );
            const canvas = getCanvas(container);
            const peakX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 200;

            fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 50, pointerId: 12 });
            fireEvent.pointerMove(canvas, { clientX: peakX + 10, clientY: 20, pointerId: 12 });
            fireEvent.pointerUp(canvas, { pointerId: 12 });
            unmount();

            const edits = onPatchChange.mock.calls.map(([edit]) => edit as ProofPatchEdit);
            expect(edits.map((edit) => edit.isTransient)).toEqual([true, false]);
        });

        it('finalizes on lost pointer capture and ignores a later pointerup', () => {
            const onPatchChange = vi.fn();
            const { container, unmount } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={onPatchChange}
                />
            );
            const canvas = getCanvas(container);
            const peakX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 200;
            const capture = installPointerCaptureSpy(canvas);

            fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 50, pointerId: 13 });
            fireEvent.pointerMove(canvas, { clientX: peakX + 10, clientY: 20, pointerId: 13 });
            capture.events.push('lost');
            fireEvent.lostPointerCapture(canvas, { pointerId: 13 });
            capture.events.push('pointerup');
            fireEvent.pointerUp(canvas, { pointerId: 13 });
            unmount();

            const edits = onPatchChange.mock.calls.map(([edit]) => edit as ProofPatchEdit);
            expect(edits.map((edit) => edit.isTransient)).toEqual([true, false]);
            expect(capture.events).toEqual(['set:13', 'lost', 'release:13', 'pointerup']);
        });

        it.each(['window blur', 'canvas blur', 'hidden document'])(
            'finalizes a drag on %s and allows a new gesture',
            (source) => {
                const onPatchChange = vi.fn();
                const { container, unmount } = render(
                    <ProofEqCurve
                        patch={DEFAULT_PATCH}
                        width={200}
                        height={100}
                        gestureOwner={0}
                        onPatchChange={onPatchChange}
                    />
                );
                const canvas = getCanvas(container);
                const capture = installPointerCaptureSpy(canvas);
                const peakX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 200;

                fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 50, pointerId: 17 });
                fireEvent.pointerMove(canvas, { clientX: peakX + 10, clientY: 20, pointerId: 17 });
                const firstTransientEdit = onPatchChange.mock.calls.at(-1)?.[0] as ProofPatchEdit;

                const previousVisibility = document.visibilityState;
                if (source === 'window blur') {
                    fireEvent.blur(window);
                } else if (source === 'canvas blur') {
                    fireEvent.blur(canvas);
                } else {
                    setDocumentVisibility('hidden');
                    document.dispatchEvent(new Event('visibilitychange'));
                }
                setDocumentVisibility(previousVisibility);

                expect(onPatchChange.mock.calls).toHaveLength(2);
                expect(onPatchChange.mock.calls[1]?.[0]).toMatchObject({
                    value: firstTransientEdit.value,
                    isTransient: false,
                });
                expect(capture.events).toEqual(['set:17', 'release:17']);

                fireEvent.lostPointerCapture(canvas, { pointerId: 17 });
                fireEvent.pointerUp(canvas, { pointerId: 17 });

                fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 50, pointerId: 18 });
                fireEvent.pointerMove(canvas, { clientX: peakX + 15, clientY: 20, pointerId: 18 });
                const secondTransientEdit = onPatchChange.mock.calls.at(-1)?.[0] as ProofPatchEdit;
                fireEvent.pointerUp(canvas, { pointerId: 18 });
                unmount();

                expect(onPatchChange.mock.calls.map(([edit]) => (edit as ProofPatchEdit).isTransient)).toEqual([
                    true,
                    false,
                    true,
                    false,
                ]);
                expect(onPatchChange.mock.calls[3]?.[0]).toMatchObject({
                    value: secondTransientEdit.value,
                    isTransient: false,
                });
                expect(capture.events).toEqual(['set:17', 'release:17', 'set:18', 'release:18']);
            }
        );

        it.each([
            ['pointerup', (canvas: HTMLCanvasElement) => fireEvent.pointerUp(canvas, { pointerId: 15 })],
            ['pointercancel', (canvas: HTMLCanvasElement) => fireEvent.pointerCancel(canvas, { pointerId: 15 })],
            [
                'lost pointer capture',
                (canvas: HTMLCanvasElement) => fireEvent.lostPointerCapture(canvas, { pointerId: 15 }),
            ],
            ['unmount', (_canvas: HTMLCanvasElement, unmount: () => void) => unmount()],
        ])('cancels a stale finalizer after authoritative replacement via %s', (_end, endGesture) => {
            const onPatchChange = vi.fn();
            const { container, rerender, unmount } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={onPatchChange}
                />
            );
            const canvas = getCanvas(container);
            const peakX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 200;

            fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 50, pointerId: 15 });
            fireEvent.pointerMove(canvas, { clientX: peakX + 10, clientY: 20, pointerId: 15 });

            const authoritativePatch: ProofPatch = {
                ...DEFAULT_PATCH,
                name: 'Streaming Master',
                presetId: 'streaming',
                eqBands: DEFAULT_PATCH.eqBands.map((band, index) =>
                    index === 2 ? { ...band, freq: 400, gain: -3 } : { ...band }
                ),
            };
            rerender(
                <ProofEqCurve
                    patch={authoritativePatch}
                    width={200}
                    height={100}
                    gestureOwner={1}
                    onPatchChange={onPatchChange}
                />
            );

            endGesture(canvas, unmount);

            expect(onPatchChange).toHaveBeenCalledTimes(1);
            expect(onPatchChange.mock.calls[0]?.[0]).toMatchObject({ isTransient: true });
        });

        it('does not commit when a dragged band returns to its starting position', () => {
            const onPatchChange = vi.fn();
            const { container } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={onPatchChange}
                />
            );
            const canvas = getCanvas(container);
            const peakX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 200;

            fireEvent.pointerDown(canvas, { clientX: peakX, clientY: 50, pointerId: 4 });
            fireEvent.pointerMove(canvas, { clientX: peakX + 10, clientY: 20, pointerId: 4 });
            fireEvent.pointerMove(canvas, { clientX: peakX, clientY: 50, pointerId: 4 });
            fireEvent.pointerUp(canvas, { pointerId: 4 });

            const edits = onPatchChange.mock.calls as Array<[ProofPatchEdit]>;
            expect(edits).toHaveLength(2);
            expect(edits.some(([edit]) => edit.isTransient === false)).toBe(false);
        });

        it('keeps the first pointer as drag owner when another pointer cancels', () => {
            const onPatchChange = vi.fn();
            const { container } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={onPatchChange}
                />
            );
            const canvas = getCanvas(container);
            const firstBandX = (Math.log10(250 / 20) / Math.log10(20000 / 20)) * 200;
            const secondBandX = (Math.log10(800 / 20) / Math.log10(20000 / 20)) * 200;

            fireEvent.pointerDown(canvas, { clientX: firstBandX, clientY: 50, pointerId: 5 });
            fireEvent.pointerMove(canvas, { clientX: firstBandX + 5, clientY: 30, pointerId: 5 });
            fireEvent.pointerDown(canvas, { clientX: secondBandX, clientY: 50, pointerId: 6 });
            fireEvent.pointerCancel(canvas, { pointerId: 6 });
            fireEvent.pointerMove(canvas, { clientX: firstBandX + 10, clientY: 20, pointerId: 5 });
            fireEvent.pointerUp(canvas, { pointerId: 5 });

            const edits = onPatchChange.mock.calls.map(([edit]) => edit as ProofPatchEdit);
            expect(edits).toHaveLength(3);
            expect(edits.map((edit) => edit.isTransient)).toEqual([true, true, false]);
            expect(edits[2]).toMatchObject({ key: 'eqBands', value: edits[1]?.value });
        });
    });

    describe('keyboard band handles', () => {
        const getBandSliders = (container: HTMLElement): HTMLElement[] =>
            Array.from(container.querySelectorAll('[role="slider"]'));

        it('exposes one focusable slider per EQ band', () => {
            const { container } = render(
                <ProofEqCurve patch={DEFAULT_PATCH} width={200} height={100} gestureOwner={0} onPatchChange={vi.fn()} />
            );
            const sliders = getBandSliders(container);
            expect(sliders).toHaveLength(DEFAULT_PATCH.eqBands.length);
            expect(sliders.every((slider) => slider.getAttribute('tabindex') === '0')).toBe(true);
        });

        it('nudges frequency right on ArrowRight and commits a non-transient edit', () => {
            const onPatchChange = vi.fn();
            const { container } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={onPatchChange}
                />
            );
            // Band index 2 of DEFAULT_PATCH is a peak at 250 Hz.
            fireEvent.keyDown(getBandSliders(container)[2]!, { key: 'ArrowRight' });

            expect(onPatchChange).toHaveBeenCalledTimes(1);
            const edit = onPatchChange.mock.calls[0]?.[0] as Extract<ProofPatchEdit, { key: 'eqBands' }>;
            expect(edit).toMatchObject({
                key: 'eqBands',
                isTransient: false,
                changedParams: [{ bandIndex: 2, field: 'freq' }],
            });
            // 250 * 1.05 = 262.5, rounded to 263 Hz; gain untouched.
            expect(edit.value[2]).toMatchObject({ freq: 263, gain: 0 });
        });

        it('nudges gain up on ArrowUp for a peak band', () => {
            const onPatchChange = vi.fn();
            const { container } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={onPatchChange}
                />
            );
            fireEvent.keyDown(getBandSliders(container)[2]!, { key: 'ArrowUp' });

            expect(onPatchChange).toHaveBeenCalledTimes(1);
            const edit = onPatchChange.mock.calls[0]?.[0] as Extract<ProofPatchEdit, { key: 'eqBands' }>;
            expect(edit).toMatchObject({
                key: 'eqBands',
                isTransient: false,
                changedParams: [{ bandIndex: 2, field: 'gain' }],
            });
            // 0 + 0.5 dB step; frequency untouched.
            expect(edit.value[2]).toMatchObject({ freq: 250, gain: 0.5 });
        });

        it('ignores vertical arrow keys on HP/LP bands (no gain axis)', () => {
            const onPatchChange = vi.fn();
            const { container } = render(
                <ProofEqCurve
                    patch={DEFAULT_PATCH}
                    width={200}
                    height={100}
                    gestureOwner={0}
                    onPatchChange={onPatchChange}
                />
            );
            // Band index 0 of DEFAULT_PATCH is a high-pass filter — vertical nudge is a no-op.
            expect(DEFAULT_PATCH.eqBands[0]!.type).toBe(EQ_HIGH_PASS);
            fireEvent.keyDown(getBandSliders(container)[0]!, { key: 'ArrowUp' });
            expect(onPatchChange).not.toHaveBeenCalled();
        });
    });
});

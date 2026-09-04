import type { ComponentProps } from 'react';

import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CrustWaveformDisplay } from '../CrustWaveformDisplay';

type Draw = ComponentProps<typeof CrustWaveformDisplay>;

// Build a recording 2d context so we can assert which render layers fired.
// Method calls are recorded; fillStyle assignments are captured via a setter
// so we can assert which colour each layer painted with.
function recordingContext(): CanvasRenderingContext2D & {
    calls: Array<{ method: string; args: unknown[] }>;
} {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    let fillStyleVal = '';
    const ctx = {
        calls,
        canvas: {},
        get fillStyle() {
            return fillStyleVal;
        },
        set fillStyle(v: string) {
            fillStyleVal = v;
            calls.push({ method: 'fillStyle', args: [v] });
        },
        fillRect: (...args: unknown[]) => calls.push({ method: 'fillRect', args }),
        fillText: (...args: unknown[]) => calls.push({ method: 'fillText', args }),
        beginPath: () => calls.push({ method: 'beginPath', args: [] }),
        moveTo: (...args: unknown[]) => calls.push({ method: 'moveTo', args }),
        lineTo: (...args: unknown[]) => calls.push({ method: 'lineTo', args }),
        closePath: () => calls.push({ method: 'closePath', args: [] }),
        fill: () => calls.push({ method: 'fill', args: [] }),
        stroke: () => calls.push({ method: 'stroke', args: [] }),
        setLineDash: (...args: unknown[]) => calls.push({ method: 'setLineDash', args }),
        measureText: () => ({ width: 0 }),
        arc: () => {},
        translate: () => {},
        scale: () => {},
        rotate: () => {},
        strokeRect: () => {},
        strokeText: () => {},
        transform: () => {},
        rect: () => {},
        clip: () => {},
        quadraticCurveTo: () => {},
        bezierCurveTo: () => {},
        arcTo: () => {},
        ellipse: () => {},
        roundRect: () => {},
        resetTransform: () => {},
        getLineDash: () => [],
        strokeStyle: '',
        lineWidth: 1,
        lineCap: 'butt',
        lineJoin: 'miter',
        miterLimit: 10,
        font: '',
        textAlign: 'start',
        textBaseline: 'alphabetic',
        direction: 'inherit',
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        imageSmoothingEnabled: true,
        lineDashOffset: 0,
        shadowBlur: 0,
        shadowColor: '',
        shadowOffsetX: 0,
        shadowOffsetY: 0,
    } as unknown as CanvasRenderingContext2D & { calls: Array<{ method: string; args: unknown[] }> };
    return ctx;
}

describe('CrustWaveformDisplay', () => {
    let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
    let originalRaf: typeof globalThis.requestAnimationFrame;
    let originalCancelRaf: typeof globalThis.cancelAnimationFrame;

    beforeEach(() => {
        originalGetContext = HTMLCanvasElement.prototype.getContext;
        originalRaf = globalThis.requestAnimationFrame;
        originalCancelRaf = globalThis.cancelAnimationFrame;
        // Single-shot rAF: run the very first scheduled callback synchronously,
        // then become inert. The component calls requestAnimationFrame(draw) at
        // the TOP of draw() (recursively rescheduling itself), so an always-firing
        // rAF would recurse forever. One draw pass is enough to assert the layers.
        let fired = false;
        globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
            if (!fired) {
                fired = true;
                cb(0);
            }
            return 0;
        };
        globalThis.cancelAnimationFrame = (): void => undefined;
    });

    afterEach(() => {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
    });

    function renderWithRecording(props: Draw): {
        ctx: CanvasRenderingContext2D & { calls: Array<{ method: string; args: unknown[] }> };
        container: HTMLElement;
    } {
        const ctx = recordingContext();
        // @ts-expect-error — jsdom stub covers only the '2d' path; the overloaded return type is intentionally incomplete (mirrors setupTests.ts)
        HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, contextId: string) {
            if (contextId === '2d') {
                (ctx as { canvas: HTMLCanvasElement }).canvas = this;
                return ctx;
            }
            return null;
        };
        const { container } = render(<CrustWaveformDisplay {...props} />);
        return { ctx, container };
    }

    describe('canvas element attributes', () => {
        it('renders the canvas with role=img, the accessible label, and fixed backing size', () => {
            const { container } = render(
                <CrustWaveformDisplay
                    grDb={0}
                    inputDb={-6}
                    outputDb={-6}
                    lufsShortTerm={-12}
                    lufsTarget={-14}
                    deltaListen={false}
                    scrollSpeed="normal"
                />
            );
            const canvas = container.querySelector('canvas')!;
            expect(canvas.getAttribute('role')).toBe('img');
            expect(canvas.getAttribute('aria-label')).toBe('Real-time waveform and gain reduction display');
            expect(canvas.getAttribute('width')).toBe('420');
            expect(canvas.getAttribute('height')).toBe('160');
            expect(canvas.style.imageRendering).toBe('pixelated');
        });

        it('uses the neutral background on the wrapper div in non-delta mode', () => {
            const { container } = render(
                <CrustWaveformDisplay
                    grDb={0}
                    inputDb={-6}
                    outputDb={-6}
                    lufsShortTerm={-12}
                    lufsTarget={null}
                    deltaListen={false}
                    scrollSpeed="normal"
                />
            );
            const wrapper = container.firstElementChild as HTMLElement;
            expect(wrapper).toHaveClass('bg-surface-well');
        });

        it('uses the same neutral wrapper background in delta mode', () => {
            const { container } = render(
                <CrustWaveformDisplay
                    grDb={0}
                    inputDb={-6}
                    outputDb={-6}
                    lufsShortTerm={-12}
                    lufsTarget={null}
                    deltaListen={true}
                    scrollSpeed="normal"
                />
            );
            const wrapper = container.firstElementChild as HTMLElement;
            expect(wrapper).toHaveClass('bg-surface-well');
        });
    });

    describe('delta-mode rendering', () => {
        it('paints the delta background and the delta-listen banner text', () => {
            const { ctx } = renderWithRecording({
                grDb: -6,
                inputDb: -6,
                outputDb: -6,
                lufsShortTerm: -12,
                lufsTarget: null,
                deltaListen: true,
                scrollSpeed: 'fast',
            });
            const fillStyles = ctx.calls.filter((c) => c.method === 'fillStyle').map((c) => c.args[0]);
            expect(fillStyles).toContain('#1A0805');
            const banner = ctx.calls.find(
                (c) => c.method === 'fillText' && c.args[0] === '◉  LISTENING TO GAIN REDUCTION ONLY'
            );
            expect(banner).toBeTruthy();
        });

        it('uses the delta GR fill colour (red)', () => {
            const { ctx } = renderWithRecording({
                grDb: -6,
                inputDb: -6,
                outputDb: -6,
                lufsShortTerm: -12,
                lufsTarget: null,
                deltaListen: true,
                scrollSpeed: 'fast',
            });
            const fillStyles = ctx.calls.filter((c) => c.method === 'fillStyle').map((c) => c.args[0]);
            // delta branch sets fillStyle to rgba(196,64,48,0.65) for the GR fill
            expect(fillStyles).toContain('rgba(196,64,48,0.65)');
        });

        it('does not paint the input/output waveform layers in delta mode', () => {
            const { ctx } = renderWithRecording({
                grDb: -6,
                inputDb: -6,
                outputDb: -6,
                lufsShortTerm: -12,
                lufsTarget: null,
                deltaListen: true,
                scrollSpeed: 'fast',
            });
            const fillStyles = ctx.calls.filter((c) => c.method === 'fillStyle').map((c) => c.args[0]);
            expect(fillStyles).not.toContain('rgba(74,158,204,0.55)');
            expect(fillStyles).not.toContain('rgba(31,107,153,0.75)');
        });
    });

    describe('normal-mode rendering', () => {
        it('paints the neutral background and the input waveform layer', () => {
            const { ctx } = renderWithRecording({
                grDb: -2,
                inputDb: -3,
                outputDb: -5,
                lufsShortTerm: -12,
                lufsTarget: null,
                deltaListen: false,
                scrollSpeed: 'fast',
            });
            const fillStyles = ctx.calls.filter((c) => c.method === 'fillStyle').map((c) => c.args[0]);
            expect(fillStyles).toContain('#0E0E10');
            // input waveform layer paints with the cyan-blue fill
            expect(fillStyles).toContain('rgba(74,158,204,0.55)');
            expect(ctx.calls.some((c) => c.method === 'fill')).toBe(true);
        });

        it('paints the red GR-gap fill when input exceeds output (compression)', () => {
            const { ctx } = renderWithRecording({
                grDb: -2,
                inputDb: -3,
                outputDb: -5,
                lufsShortTerm: -12,
                lufsTarget: null,
                deltaListen: false,
                scrollSpeed: 'fast',
            });
            // inputDb=-3 normalises higher than outputDb=-5 → the `inv > outv`
            // branch paints the red gap between the two waveforms. Layer 3 sets
            // this fillStyle unconditionally when NOT in delta mode.
            const fillStyles = ctx.calls.filter((c) => c.method === 'fillStyle').map((c) => c.args[0]);
            expect(fillStyles).toContain('rgba(196,64,48,0.18)');
        });

        it('does not paint the delta-listen banner in non-delta mode', () => {
            const { ctx } = renderWithRecording({
                grDb: -2,
                inputDb: -3,
                outputDb: -5,
                lufsShortTerm: -12,
                lufsTarget: null,
                deltaListen: false,
                scrollSpeed: 'fast',
            });
            const banner = ctx.calls.some(
                (c) => c.method === 'fillText' && c.args[0] === '◉  LISTENING TO GAIN REDUCTION ONLY'
            );
            expect(banner).toBe(false);
        });

        it('paints the target LUFS dashed line only when a target is provided', () => {
            const withTarget = renderWithRecording({
                grDb: -2,
                inputDb: -3,
                outputDb: -5,
                lufsShortTerm: -12,
                lufsTarget: -14,
                deltaListen: false,
                scrollSpeed: 'fast',
            });
            expect(
                withTarget.ctx.calls.some((c) => c.method === 'setLineDash' && JSON.stringify(c.args[0]) === '[4,4]')
            ).toBe(true);

            const noTarget = renderWithRecording({
                grDb: -2,
                inputDb: -3,
                outputDb: -5,
                lufsShortTerm: -12,
                lufsTarget: null,
                deltaListen: false,
                scrollSpeed: 'fast',
            });
            expect(
                noTarget.ctx.calls.some((c) => c.method === 'setLineDash' && JSON.stringify(c.args[0]) === '[4,4]')
            ).toBe(false);
        });
    });

    describe('peak GR labels', () => {
        it('emits a peak-label fillText when gain reduction exceeds the 3dB threshold', () => {
            const { ctx } = renderWithRecording({
                grDb: -8,
                inputDb: -3,
                outputDb: -11,
                lufsShortTerm: -12,
                lufsTarget: null,
                deltaListen: false,
                scrollSpeed: 'fast',
            });
            // a label is pushed and drawn as fillText with the gr value (one decimal)
            const label = ctx.calls.find((c) => c.method === 'fillText' && c.args[0] === (-8).toFixed(1));
            expect(label).toBeTruthy();
        });

        it('does not emit a peak label when gain reduction is below the threshold', () => {
            const { ctx } = renderWithRecording({
                grDb: -2,
                inputDb: -3,
                outputDb: -5,
                lufsShortTerm: -12,
                lufsTarget: null,
                deltaListen: false,
                scrollSpeed: 'fast',
            });
            const label = ctx.calls.some((c) => c.method === 'fillText' && c.args[0] === (-2).toFixed(1));
            expect(label).toBe(false);
        });
    });
});

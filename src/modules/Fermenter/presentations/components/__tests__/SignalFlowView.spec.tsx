import { type ComponentProps } from 'react';

import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { SignalFlowView } from '../SignalFlowView';

import type { FermenterPatch } from '../../../models/FermenterPatch';

function patch(overrides: Partial<FermenterPatch> = {}): FermenterPatch {
    return { ...DEFAULT_PATCH, ...overrides };
}

type Props = ComponentProps<typeof SignalFlowView>;

function defaultProps(overrides: Partial<Props> = {}): Props {
    return {
        patch: patch(),
        numLayers: 1,
        activeLayer: 0,
        onSelectSection: vi.fn(),
        ...overrides,
    };
}

// Build a recording 2d context that captures fillText calls so we can assert
// the computed node labels/subtitles the component derives from the patch.
function recordingContext(): CanvasRenderingContext2D & {
    texts: Array<{ text: string; x: number; y: number }>;
} {
    const texts: Array<{ text: string; x: number; y: number }> = [];
    const grad = { addColorStop: () => {} };
    const ctx = {
        texts,
        canvas: {},
        scale: () => {},
        clearRect: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        fillText: (text: string, x: number, y: number) => texts.push({ text, x, y }),
        strokeText: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        fill: () => {},
        stroke: () => {},
        arc: () => {},
        translate: () => {},
        rotate: () => {},
        rect: () => {},
        clip: () => {},
        quadraticCurveTo: () => {},
        bezierCurveTo: () => {},
        arcTo: () => {},
        ellipse: () => {},
        roundRect: () => {},
        resetTransform: () => {},
        setLineDash: () => {},
        getLineDash: () => [],
        createLinearGradient: () => grad,
        measureText: () => ({ width: 0 }),
        fillStyle: '',
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
    } as unknown as CanvasRenderingContext2D & {
        texts: Array<{ text: string; x: number; y: number }>;
    };
    return ctx;
}

describe('SignalFlowView', () => {
    let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

    beforeEach(() => {
        originalGetContext = HTMLCanvasElement.prototype.getContext;
    });

    afterEach(() => {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
    });

    function renderWithRecording(props: Props): {
        texts: string[];
        canvas: HTMLCanvasElement;
    } {
        const ctx = recordingContext();
        // @ts-expect-error — jsdom stub covers only the '2d' path; overloaded return type intentionally incomplete (mirrors setupTests.ts)
        HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
            if (id === '2d') {
                (ctx as { canvas: HTMLCanvasElement }).canvas = this;
                return ctx;
            }
            return null;
        };
        const { container } = render(<SignalFlowView {...props} />);
        const canvas = container.querySelector('canvas')!;
        return { texts: ctx.texts.map((t) => t.text), canvas };
    }

    describe('computed node labels and subtitles', () => {
        it('renders the active layer with its engine subtitle and inactive layers with "—"', () => {
            // 2 layers, active = 1, engine = FM (2)
            const { texts } = renderWithRecording(
                defaultProps({ patch: patch({ oscEngine: 2 }), numLayers: 2, activeLayer: 1 })
            );
            // Layer 1 (inactive) subtitle is "—"; Layer 2 (active) subtitle is "FM"
            expect(texts).toContain('Layer 1');
            expect(texts).toContain('—');
            expect(texts).toContain('FM');
        });

        it('shows "WT" fallback subtitle when oscEngine is out of range', () => {
            // oscEngine 99 → ENGINE_NAMES[99] is undefined → fallback 'WT'
            const { texts } = renderWithRecording(defaultProps({ patch: patch({ oscEngine: 99 }) }));
            expect(texts).toContain('WT');
        });

        it('shows the Warp node as "Off" when warpMode/amount are inactive', () => {
            const { texts } = renderWithRecording(defaultProps({ patch: patch({ warpMode: 0, warpAmount: 0 }) }));
            expect(texts).toContain('Warp');
            expect(texts).toContain('Off');
        });

        it('shows the Warp node with its mode name when active', () => {
            // warpMode 2 → 'Quantize'; amount > 0.001 activates it
            const { texts } = renderWithRecording(defaultProps({ patch: patch({ warpMode: 2, warpAmount: 0.5 }) }));
            expect(texts).toContain('Quantize');
        });

        it('shows the Filter node with the resolved filter model name', () => {
            // filterModel 1 → 'Moog (Warm)'; default falls back to 'SVF'
            const warm = renderWithRecording(defaultProps({ patch: patch({ filterModel: 1 }) }));
            expect(warm.texts).toContain('Moog (Warm)');

            const svf = renderWithRecording(defaultProps({ patch: patch({ filterModel: 0 }) }));
            expect(svf.texts).toContain('SVF (Clean)');
        });

        it('shows Voice FX drive value when active, else Off', () => {
            const off = renderWithRecording(defaultProps({ patch: patch({ voiceDrive: 0 }) }));
            expect(off.texts).toContain('Off');

            const on = renderWithRecording(defaultProps({ patch: patch({ voiceDrive: 0.5 }) }));
            expect(on.texts).toContain('Drive 0.5');
        });

        it('shows Distortion mix percentage when active, else Off', () => {
            const off = renderWithRecording(defaultProps({ patch: patch({ distMix: 0 }) }));
            expect(off.texts).toContain('Off');

            const on = renderWithRecording(defaultProps({ patch: patch({ distMix: 0.25 }) }));
            expect(on.texts).toContain('25%');
        });

        it('shows Compressor ratio when active, else Off', () => {
            const off = renderWithRecording(defaultProps({ patch: patch({ compMix: 0 }) }));
            expect(off.texts).toContain('Off');

            const on = renderWithRecording(defaultProps({ patch: patch({ compMix: 0.5, compRatio: 7 }) }));
            expect(on.texts).toContain('7:1');
        });

        it('renders the Plate vs FDN reverb label depending on reverbType', () => {
            const plate = renderWithRecording(defaultProps({ patch: patch({ reverbType: 0 }) }));
            expect(plate.texts).toContain('Plate Rev');

            const fdn = renderWithRecording(defaultProps({ patch: patch({ reverbType: 1 }) }));
            expect(fdn.texts).toContain('FDN Rev');
        });

        it('shows the reverb mix percentage when active, else Off', () => {
            const off = renderWithRecording(defaultProps({ patch: patch({ reverbMix: 0 }) }));
            expect(off.texts).toContain('Off');

            // default reverbMix 0.2 → 20%
            const on = renderWithRecording(defaultProps());
            expect(on.texts).toContain('20%');
        });

        it('shows EQ as "3-Band" when any band gain is non-trivial, else Flat', () => {
            const flat = renderWithRecording(
                defaultProps({ patch: patch({ eqLowGain: 0, eqMidGain: 0, eqHighGain: 0 }) })
            );
            expect(flat.texts).toContain('Flat');

            const active = renderWithRecording(defaultProps({ patch: patch({ eqHighGain: 3 }) }));
            expect(active.texts).toContain('3-Band');
        });

        it('shows Delay time in ms when active, else Off', () => {
            const off = renderWithRecording(defaultProps({ patch: patch({ delayMix: 0 }) }));
            expect(off.texts).toContain('Off');

            const on = renderWithRecording(defaultProps({ patch: patch({ delayMix: 0.5, delayTime: 420 }) }));
            expect(on.texts).toContain('420ms');
        });

        it('shows Chorus and Phaser mix percentages when active, else Off', () => {
            const off = renderWithRecording(defaultProps({ patch: patch({ chorusMix: 0, phaserMix: 0 }) }));
            // both Off — at least two "Off" subtitles exist; assert presence
            expect(off.texts.filter((t) => t === 'Off').length).toBeGreaterThanOrEqual(2);

            const on = renderWithRecording(defaultProps({ patch: patch({ chorusMix: 0.4, phaserMix: 0.6 }) }));
            expect(on.texts).toContain('40%');
            expect(on.texts).toContain('60%');
        });

        it('shows Width as a rounded percentage and Master as the gain percentage', () => {
            const { texts } = renderWithRecording(
                defaultProps({ patch: patch({ stereoWidth: 1.5, masterGain: 0.8 }) })
            );
            expect(texts).toContain('150%');
            expect(texts).toContain('80%');
        });
    });

    describe('node hit-testing → onSelectSection mapping', () => {
        it('maps the oscillator node click to the "osc" section', () => {
            const onSelectSection = vi.fn();
            const { canvas } = renderWithRecording(defaultProps({ onSelectSection }));
            // Layer 1 node: x=10..100, y=10..38 → click its centre
            fireEvent.click(canvas, { clientX: 55, clientY: 24 });
            expect(onSelectSection).toHaveBeenCalledWith('osc');
        });

        it('maps the Warp node click to the "osc" section (shares the oscillator section)', () => {
            const onSelectSection = vi.fn();
            const { canvas } = renderWithRecording(defaultProps({ onSelectSection }));
            // Warp node x = 10 + 90 + 16 = 116..206, y=10..38
            fireEvent.click(canvas, { clientX: 160, clientY: 24 });
            expect(onSelectSection).toHaveBeenCalledWith('osc');
        });

        it('maps the Filter node click to the "filter" section', () => {
            const onSelectSection = vi.fn();
            const { canvas } = renderWithRecording(defaultProps({ onSelectSection }));
            // Filter x = 116 + 90 + 16 = 222..312, y=10..38
            fireEvent.click(canvas, { clientX: 267, clientY: 24 });
            expect(onSelectSection).toHaveBeenCalledWith('filter');
        });

        it('maps effect nodes (Distortion/Reverb/EQ/Delay/etc.) to the "fx" section', () => {
            const onSelectSection = vi.fn();
            const { canvas } = renderWithRecording(defaultProps({ onSelectSection }));
            // Distortion x = 222 + 90 + 16 = 328..418 (after Voice FX), y=10..38.
            // Voice FX is at 328..418; Distortion at 434..524.
            fireEvent.click(canvas, { clientX: 480, clientY: 24 });
            expect(onSelectSection).toHaveBeenCalledWith('fx');
        });

        it('does not call onSelectSection when clicking empty space', () => {
            const onSelectSection = vi.fn();
            const { canvas } = renderWithRecording(defaultProps({ onSelectSection }));
            // Click far outside any node
            fireEvent.click(canvas, { clientX: 5, clientY: 5 });
            expect(onSelectSection).not.toHaveBeenCalled();
        });
    });
});

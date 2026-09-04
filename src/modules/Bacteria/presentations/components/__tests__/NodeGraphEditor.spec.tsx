import { type ComponentProps } from 'react';

import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/BacteriaPatch';
import { NodeGraphEditor } from '../NodeGraphEditor';

import type { BacteriaBand } from '../../../models/BacteriaPatch';

function band(overrides: Partial<BacteriaBand> = {}): BacteriaBand {
    return { ...DEFAULT_PATCH.bands[0]!, ...overrides };
}

type Props = ComponentProps<typeof NodeGraphEditor>;

function defaultProps(overrides: Partial<Props> = {}): Props {
    return {
        width: 320,
        height: 200,
        bandCount: 2,
        bands: [band(), band()],
        globalRouting: 'serial',
        crossoverFreqs: [500, 2000],
        ...overrides,
    };
}

describe('NodeGraphEditor', () => {
    describe('svg element', () => {
        it('renders an svg with the given width/height and a fixed grid background', () => {
            const { container } = render(<NodeGraphEditor {...defaultProps()} />);
            const svg = container.querySelector('svg')!;
            expect(svg.getAttribute('width')).toBe('320');
            expect(svg.getAttribute('height')).toBe('200');
            expect(svg).toHaveClass('bg-surface-inset');
        });

        it('renders the routing-mode label as the right-aligned text', () => {
            const { container } = render(<NodeGraphEditor {...defaultProps({ globalRouting: 'mid-side' })} />);
            const labels = [...container.querySelectorAll('text')].map((t) => t.textContent);
            expect(labels).toContain('mid-side');
        });
    });

    describe('node topology by band count', () => {
        it('renders Input, Crossover, two Band, Sum, and Output nodes for a multi-band graph', () => {
            const { container } = render(<NodeGraphEditor {...defaultProps({ bandCount: 2 })} />);
            const labels = [...container.querySelectorAll('text')].map((t) => t.textContent);
            expect(labels).toContain('Input');
            expect(labels).toContain('Crossover');
            expect(labels).toContain('Band 1');
            expect(labels).toContain('Band 2');
            expect(labels).toContain('Sum');
            expect(labels).toContain('Output');
        });

        it('omits the Crossover node for a single-band graph', () => {
            const { container } = render(
                <NodeGraphEditor {...defaultProps({ bandCount: 1, bands: [band()], crossoverFreqs: [] })} />
            );
            const labels = [...container.querySelectorAll('text')].map((t) => t.textContent);
            expect(labels).not.toContain('Crossover');
            expect(labels).toContain('Band 1');
        });

        it('renders one Band node per band count, labelled 1-based', () => {
            const { container } = render(
                <NodeGraphEditor
                    {...defaultProps({
                        bandCount: 3,
                        bands: [band(), band(), band()],
                        crossoverFreqs: [200, 1000, 4000],
                    })}
                />
            );
            const labels = [...container.querySelectorAll('text')].map((t) => t.textContent);
            expect(labels).toContain('Band 1');
            expect(labels).toContain('Band 2');
            expect(labels).toContain('Band 3');
        });
    });

    describe('connections', () => {
        it('connects Input→Crossover and each Band→Sum→Output for multi-band', () => {
            const { container } = render(<NodeGraphEditor {...defaultProps({ bandCount: 2 })} />);
            // multi-band: input→crossover (1), crossover→2 bands (2), 2 bands→sum (2), sum→output (1) = 6 paths
            const paths = container.querySelectorAll('path');
            expect(paths.length).toBe(6);
        });

        it('connects Input→Band→Sum→Output directly for single-band (no crossover)', () => {
            const { container } = render(
                <NodeGraphEditor {...defaultProps({ bandCount: 1, bands: [band()], crossoverFreqs: [] })} />
            );
            // single-band: input→band (1), band→sum (1), sum→output (1) = 3 paths
            const paths = container.querySelectorAll('path');
            expect(paths.length).toBe(3);
        });
    });

    describe('band effect labels', () => {
        it('lists the enabled effect short-names for a band node', () => {
            const bands = [
                band({
                    distortionEnabled: true,
                    filterEnabled: true,
                    chorusEnabled: true,
                    granularEnabled: true,
                }),
                band(),
            ];
            const { container } = render(<NodeGraphEditor {...defaultProps({ bandCount: 2, bands })} />);
            const labels = [...container.querySelectorAll('text')].map((t) => t.textContent);
            expect(labels).toContain('Dist');
            expect(labels).toContain('Filter');
            expect(labels).toContain('Chorus');
            expect(labels).toContain('Grain');
        });

        it('maps the remaining effect keys to their short labels', () => {
            const bands = [
                band({
                    spectralEnabled: true,
                    freqShiftEnabled: true,
                    lofiEnabled: true,
                    convolutionEnabled: true,
                }),
                band(),
            ];
            const { container } = render(<NodeGraphEditor {...defaultProps({ bandCount: 2, bands })} />);
            const labels = [...container.querySelectorAll('text')].map((t) => t.textContent);
            expect(labels).toContain('Spectral');
            expect(labels).toContain('FShift');
            expect(labels).toContain('Lo-Fi');
            expect(labels).toContain('Body');
        });

        it('renders no effect labels for a band with no enabled effects', () => {
            const bands = [band(), band()];
            const { container } = render(<NodeGraphEditor {...defaultProps({ bandCount: 2, bands })} />);
            const labels = [...container.querySelectorAll('text')].map((t) => t.textContent);
            expect(labels).not.toContain('Dist');
            expect(labels).not.toContain('Filter');
        });

        it('does not surface modulation/phaser flags (absent from EFFECT_KEYS) as labels', () => {
            // modulationEnabled and phaserEnabled are band flags but are NOT in
            // the EFFECT_KEYS map, so enabling them must not add any effect label.
            const bands = [band({ modulationEnabled: true, phaserEnabled: true }), band()];
            const { container } = render(<NodeGraphEditor {...defaultProps({ bandCount: 2, bands })} />);
            const labels = [...container.querySelectorAll('text')].map((t) => t.textContent);
            // the only rendered texts are the node labels + routing mode; no
            // effect short-names appear for these two flags.
            expect(labels).not.toContain('Modulation');
            expect(labels).not.toContain('Phaser');
            expect(labels).not.toContain('Mod');
        });
    });

    describe('node sizing', () => {
        it('sizes band nodes wider (80px) than other nodes (60px)', () => {
            const { container } = render(
                <NodeGraphEditor {...defaultProps({ bandCount: 1, bands: [band()], crossoverFreqs: [] })} />
            );
            const rects = [...container.querySelectorAll('rect')] as SVGRectElement[];
            // rects[0] is the grid background; the rest are node rects.
            const nodeRects = rects.slice(1);
            const widths = nodeRects.map((r) => Number(r.getAttribute('width')));
            // band node is 80; input/output/sum are 60
            expect(widths).toContain(80);
            expect(widths.filter((w) => w === 60).length).toBeGreaterThanOrEqual(3);
        });

        it('grows a band node height with each enabled effect', () => {
            // band with 4 effects → height 50 + 4*10 = 90; no-effect band → 50
            const withFx = band({
                distortionEnabled: true,
                filterEnabled: true,
                chorusEnabled: true,
                granularEnabled: true,
            });
            const { container } = render(
                <NodeGraphEditor {...defaultProps({ bandCount: 1, bands: [withFx], crossoverFreqs: [] })} />
            );
            const rects = [...container.querySelectorAll('rect')] as SVGRectElement[];
            const bandRect = rects.find((r) => Number(r.getAttribute('width')) === 80)!;
            expect(bandRect.getAttribute('height')).toBe('90');
        });
    });

    describe('hover state', () => {
        it('changes the hovered Input node fill alpha to 20 and stroke-width to 1.5', () => {
            const { container } = render(
                <NodeGraphEditor {...defaultProps({ bandCount: 1, bands: [band()], crossoverFreqs: [] })} />
            );
            const groups = [...container.querySelectorAll('g')];
            const inputGroup = groups.find((g) => g.querySelector('text')?.textContent === 'Input')!;
            const rect = inputGroup.querySelector('rect')!;
            // non-hovered: alpha suffix '10', stroke-width 1
            expect(rect.getAttribute('fill')).toBe('rgb(255,255,255)10');
            expect(rect.getAttribute('stroke-width')).toBe('1');

            fireEvent.mouseEnter(inputGroup);
            // re-query the SAME rect: hovered fill alpha '20', stroke-width 1.5
            const rectAfter = inputGroup.querySelector('rect')!;
            expect(rectAfter.getAttribute('fill')).toBe('rgb(255,255,255)20');
            expect(rectAfter.getAttribute('stroke-width')).toBe('1.5');
        });

        it('clears the hover state on mouseLeave, restoring the non-hovered fill', () => {
            const { container } = render(
                <NodeGraphEditor {...defaultProps({ bandCount: 1, bands: [band()], crossoverFreqs: [] })} />
            );
            const inputGroup = [...container.querySelectorAll('g')].find(
                (g) => g.querySelector('text')?.textContent === 'Input'
            )!;
            fireEvent.mouseEnter(inputGroup);
            expect(inputGroup.querySelector('rect')!.getAttribute('fill')).toBe('rgb(255,255,255)20');

            fireEvent.mouseLeave(inputGroup);
            expect(inputGroup.querySelector('rect')!.getAttribute('fill')).toBe('rgb(255,255,255)10');
        });
    });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type Rgba = { r: number; g: number; b: number; a: number };

const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const sliderSource = readFileSync(resolve(process.cwd(), 'src/components/ui/slider.tsx'), 'utf8');

const readToken = (name: string): string => {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(tokensCss);
    if (match?.[1] === undefined) {
        throw new Error(`token ${name} is not defined in tokens.css`);
    }
    return match[1].trim();
};

const parseColor = (value: string): Rgba => {
    const hex = /^#([0-9a-f]{6})$/i.exec(value);
    if (hex?.[1] !== undefined) {
        const n = parseInt(hex[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(value);
    if (rgba === null) {
        throw new Error(`unsupported colour ${value}`);
    }
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: Number(rgba[4]) };
};

const over = (top: Rgba, under: Rgba): Rgba => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
});

const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = (c: Rgba): number => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);

const contrast = (a: Rgba, b: Rgba): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

const color = (name: string): Rgba => parseColor(readToken(name));

const surfaces = ['--surface-base', '--surface-default', '--surface-raised', '--surface-overlay'];
const fills = ['cyan', 'peach', 'lavender'].flatMap((hue) => [
    `--color-control-fill-${hue}-top`,
    `--color-control-fill-${hue}-bottom`,
]);

describe('slider rail contrast (WCAG 1.4.11)', () => {
    it.each(surfaces)('should keep the rail edge at 3:1 or more against %s', (surface) => {
        expect(contrast(color('--color-control-rail-edge'), color(surface))).toBeGreaterThanOrEqual(3);
    });

    it.each(fills)('should keep fill %s at 3:1 or more against the dark interior', (fill) => {
        const interior = color('--color-bg-panelInset');
        expect(contrast(over(color(fill), interior), interior)).toBeGreaterThanOrEqual(3);
    });

    it('should draw the shared track with the edge and interior tokens and the cyan fill tokens', () => {
        expect(sliderSource).toContain('border-control-rail-edge');
        expect(sliderSource).toContain('bg-surface-inset');
        expect(sliderSource).toContain('var(--color-control-fill-cyan-top)');
        expect(sliderSource).toContain('var(--color-control-fill-cyan-bottom)');
    });
});

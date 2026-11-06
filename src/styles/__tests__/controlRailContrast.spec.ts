import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type Rgba = { r: number; g: number; b: number; a: number };

const readSource = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const tokensCss = readSource('src/styles/tokens.css');
const floatingSurfaceCss = readSource('src/styles/main.css');
const sliderSource = readSource('src/components/ui/slider.tsx');
const hammondSource = readSource(
    'src/modules/TimelineEditor/presentations/views/Inspector/layouts/HammondB3Layout.tsx'
);
const keyboardSource = readSource('src/modules/WorkspaceShell/presentations/views/VirtualKeyboard.tsx');

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

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/**
 * Brightest point of the `daw-floating-surface` background over `base`: the cream sheen fades from its first
 * to its second alpha down the surface while the black scrim fades out by 18%, so sample the whole height.
 */
const floatingSurfaceBackgrounds = (base: Rgba): Rgba[] => {
    const block = /@utility daw-floating-surface \{([^}]*)\}/.exec(floatingSurfaceCss)?.[1];
    const layers =
        /linear-gradient\(180deg, (rgba\([^)]*\)), (rgba\([^)]*\))\),\s*linear-gradient\(180deg, (rgba\([^)]*\)), transparent (\d+)%\)/.exec(
            block ?? ''
        );
    if (layers === null) {
        throw new Error('daw-floating-surface background layers not found in main.css');
    }
    const sheenTop = parseColor(layers[1] ?? '');
    const sheenBottom = parseColor(layers[2] ?? '');
    const scrim = parseColor(layers[3] ?? '');
    const scrimEnd = Number(layers[4]) / 100;
    return Array.from({ length: 101 }, (_, step) => {
        const t = step / 100;
        const withSheen = over({ ...sheenTop, a: lerp(sheenTop.a, sheenBottom.a, t) }, base);
        return over({ ...scrim, a: t >= scrimEnd ? 0 : lerp(scrim.a, 0, t / scrimEnd) }, withSheen);
    });
};

const surfaceTokens = [
    '--surface-base',
    '--surface-default',
    '--surface-raised',
    '--surface-overlay',
    '--surface-dialog',
];
const fills = ['cyan', 'peach', 'lavender'].flatMap((hue) => [
    `--color-control-fill-${hue}-top`,
    `--color-control-fill-${hue}-bottom`,
]);

const classTokens = (classList: string): string[] => classList.split(/\s+/).filter((name) => name !== '');

const capture = (source: string, pattern: RegExp, label: string): string => {
    const value = pattern.exec(source)?.[1];
    if (value === undefined) {
        throw new Error(`${label} not found`);
    }
    return value;
};

type RailOwner = { name: string; track: string; range: string };

const railOwners: RailOwner[] = [
    {
        name: 'shared slider',
        track: capture(sliderSource, /data-slot="slider-track"\s*className=\{cn\(\s*'([^']*)'/, 'shared track classes'),
        range: capture(
            sliderSource,
            /data-slot="slider-range"\s*className=\{cn\(\s*'[^']*',\s*'([^']*)'/,
            'shared fill'
        ),
    },
    {
        name: 'Hammond drawbar',
        track: capture(hammondSource, /trackClassName="([^"]*)"/, 'drawbar track classes'),
        range: capture(hammondSource, /rangeClassName="([^"]*)"/, 'drawbar fill'),
    },
    {
        name: 'virtual keyboard velocity',
        track: capture(
            keyboardSource,
            /trackClassName="([^"]*)"\s*rangeClassName="[^"]*"\s*thumbClassName="[^"]*"\s*aria-label="Note velocity"/,
            'velocity track classes'
        ),
        range: capture(
            keyboardSource,
            /rangeClassName="([^"]*)"\s*thumbClassName="[^"]*"\s*aria-label="Note velocity"/,
            'velocity fill'
        ),
    },
];

describe('slider rail contrast (WCAG 1.4.11)', () => {
    it.each(surfaceTokens)('should keep the rail edge at 3:1 or more against %s', (surface) => {
        expect(contrast(color('--color-control-rail-edge'), color(surface))).toBeGreaterThanOrEqual(3);
    });

    it.each(['--color-bg-overlay', '--surface-dialog'])(
        'should keep the rail edge at 3:1 or more on the whole floating surface over %s',
        (base) => {
            const edge = color('--color-control-rail-edge');
            const baseColor = base === '--color-bg-overlay' ? color('--surface-overlay') : color(base);
            for (const background of floatingSurfaceBackgrounds(baseColor)) {
                expect(contrast(edge, background)).toBeGreaterThanOrEqual(3);
            }
        }
    );

    it.each(fills)('should keep fill %s at 3:1 or more against the dark interior', (fill) => {
        const interior = color('--color-bg-panelInset');
        expect(contrast(over(color(fill), interior), interior)).toBeGreaterThanOrEqual(3);
    });

    it.each(railOwners)('should give the $name track a border, the edge colour and the inset interior', (owner) => {
        const names = new Set(classTokens(owner.track));
        expect(names).toContain('border');
        expect(names).toContain('border-control-rail-edge');
        expect(names).toContain('bg-surface-inset');
    });

    it.each(railOwners)('should paint the $name fill from the fill tokens, never a colour literal', (owner) => {
        const gradient = capture(owner.range, /\[background:([^\]]*)\]/, `${owner.name} fill gradient`);
        expect(gradient).toMatch(/var\(--color-control-fill-[a-z]+-top\)/);
        expect(gradient).toMatch(/var\(--color-control-fill-[a-z]+-bottom\)/);
        expect(gradient).not.toMatch(/rgba?\(|hsla?\(|#[0-9a-f]{3,8}/i);
    });
});

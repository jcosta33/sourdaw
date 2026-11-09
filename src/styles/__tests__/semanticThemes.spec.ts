import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { stringify } from 'superjson';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const chipSource = readFileSync(resolve(process.cwd(), 'src/components/daw/DawPluginChip.tsx'), 'utf8');
const meteringSource = readFileSync(
    resolve(process.cwd(), 'src/modules/Crust/presentations/components/CrustMeteringStrip.tsx'),
    'utf8'
);
const lightBlock = /:root\.light\s*\{([^}]*)\}/u.exec(tokens)?.[1] ?? '';
const startupThemeMatch = /<script id="sourdaw-theme"([^>]*)>([\s\S]*?)<\/script>/u.exec(indexHtml);
const startupThemeSource = /\bsrc="([^"]+)"/u.exec(startupThemeMatch?.[1] ?? '')?.[1];
let startupThemeScript = '';
if (startupThemeSource === '/themePrepaint.js') {
    startupThemeScript = readFileSync(resolve(process.cwd(), 'public/themePrepaint.js'), 'utf8');
}

const runStartupTheme = (stored: string | null) => {
    const classes = new Set<string>(['dark']);
    const style: Record<string, string> = {};
    const metaAttributes: Record<string, string> = {};
    runInNewContext(startupThemeScript, {
        window: { localStorage: { getItem: () => stored } },
        document: {
            documentElement: {
                classList: {
                    toggle(name: string, enabled: boolean) {
                        if (enabled) {
                            classes.add(name);
                        } else {
                            classes.delete(name);
                        }
                    },
                },
                style,
            },
            querySelector: () => ({
                setAttribute(name: string, value: string) {
                    metaAttributes[name] = value;
                },
            }),
        },
    });
    return { classes, colorScheme: style.colorScheme, themeColor: metaAttributes.content };
};

const parseTagAttributes = (attributeSource: string): Map<string, string> => {
    const attributes = new Map<string, string>();
    const pattern = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gu;
    for (const match of attributeSource.matchAll(pattern)) {
        const name = match[1]?.toLowerCase();
        if (name !== undefined) {
            attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '');
        }
    }
    return attributes;
};

const readToken = (source: string, name: string): string => {
    const value = new RegExp(`${name}:\\s*([^;]+);`, 'u').exec(source)?.[1];
    if (value === undefined) {
        throw new Error(`Missing ${name}`);
    }
    return value.trim();
};

const luminance = (hex: string): number => {
    const channels = /^#([0-9a-f]{6})$/iu.exec(hex)?.[1];
    if (channels === undefined) {
        throw new Error(`Expected a six-digit hex color, received ${hex}`);
    }
    const linear = [0, 2, 4].map((offset) => {
        const value = Number.parseInt(channels.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
};

const contrast = (first: string, second: string): number => {
    const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
};

const composite = (foreground: string, background: string, alpha: number): string => {
    const channel = (hex: string, offset: number): number => Number.parseInt(hex.slice(offset, offset + 2), 16);
    const channels = [1, 3, 5].map((offset) => {
        const value = Math.round(channel(foreground, offset) * alpha + channel(background, offset) * (1 - alpha));
        return value.toString(16).padStart(2, '0');
    });
    return `#${channels.join('')}`;
};

describe('semantic light theme', () => {
    it('overrides the complete surface and text hierarchy and declares native control color scheme', () => {
        for (const name of [
            '--surface-deep',
            '--surface-base',
            '--surface-default',
            '--surface-raised',
            '--surface-overlay',
            '--surface-dialog',
            '--color-bg-well',
            '--color-bg-recess',
            '--color-bg-panelInset',
            '--color-text-primary',
            '--color-text-secondary',
            '--color-text-tertiary',
            '--color-text-disabled',
        ]) {
            expect(readToken(lightBlock, name)).toMatch(/^#[0-9a-f]{6}$/iu);
        }
        expect(lightBlock).toContain('color-scheme: light;');
    });

    it.each([
        '--surface-deep',
        '--surface-base',
        '--surface-default',
        '--surface-raised',
        '--surface-overlay',
        '--surface-dialog',
    ])('keeps primary, secondary and tertiary text at 4.5:1 on %s', (surface) => {
        for (const text of ['--color-text-primary', '--color-text-secondary', '--color-text-tertiary']) {
            expect(contrast(readToken(lightBlock, text), readToken(lightBlock, surface))).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('loads the prepaint theme from an external classic script before the entry module', () => {
        const themeAttributes = parseTagAttributes(startupThemeMatch?.[1] ?? '');
        expect(themeAttributes.get('src')).toBe('/themePrepaint.js');
        // An absent or non-JavaScript type can suppress execution; module,
        // async or defer spelling defers the prepaint past first paint and
        // restores the dark flash it exists to prevent.
        expect(themeAttributes.get('type')?.toLowerCase()).toBe('text/javascript');
        expect(themeAttributes.get('type')?.toLowerCase()).not.toBe('module');
        expect(themeAttributes.has('async')).toBe(false);
        expect(themeAttributes.has('defer')).toBe(false);
        expect(startupThemeMatch?.[2]?.trim()).toBe('');
        expect(indexHtml.indexOf('id="sourdaw-theme"')).toBeLessThan(indexHtml.indexOf('id="sourdaw-entry"'));
        expect(indexHtml).toContain(':root.light');
    });

    it('restores the persisted light theme before startup paint', () => {
        const startup = runStartupTheme(stringify({ theme: 'light' }));

        expect(startup.classes).toEqual(new Set(['light']));
        expect(startup.colorScheme).toBe('light');
        expect(startup.themeColor).toBe('#ded8cf');
        expect(indexHtml).toContain('--entry-startup-background: #ded8cf;');
    });

    it('falls back to the dark startup when persisted preferences are corrupt', () => {
        const startup = runStartupTheme('{not-json');

        expect(startup.classes).toEqual(new Set(['dark']));
        expect(startup.colorScheme).toBe('dark');
        expect(startup.themeColor).toBe('#020100');
    });

    it('keeps Crust loudness text readable on its actual raised light surface', () => {
        const meterSectionClass = /<section className=\{`([^`]*)`\}/u.exec(meteringSource)?.[1] ?? '';
        expect(meterSectionClass).toContain('bg-surface-raised');
        expect(meterSectionClass).not.toContain('bg-black');
        const background = readToken(lightBlock, '--surface-raised');
        for (const foreground of ['--color-state-play', '--color-accent-amber', '--color-accent-red']) {
            expect(contrast(readToken(lightBlock, foreground), background)).toBeGreaterThanOrEqual(4.5);
        }

        // Captions, section titles and values are small text at declared
        // alphas: their composites over the raised surface are what the
        // musician actually reads, so each must reach the 4.5:1 floor.
        const textRoles = [
            {
                attributes: ['labelClassName', 'titleClassName'],
                className: 'text-muted-foreground',
                token: '--color-text-secondary',
            },
            { attributes: ['valueClassName'], className: 'text-foreground', token: '--color-text-primary' },
        ];
        for (const { attributes, className, token } of textRoles) {
            const foreground = readToken(lightBlock, token);
            for (const attribute of attributes) {
                const alphas = Array.from(
                    meteringSource.matchAll(new RegExp(`${attribute}="[^"]*${className}/(\\d+)`, 'gu')),
                    (match) => Number(match[1])
                );
                expect(alphas.length, `${attribute} ${className} declarations`).toBeGreaterThan(0);
                for (const alpha of alphas) {
                    expect(contrast(composite(foreground, background, alpha / 100), background)).toBeGreaterThanOrEqual(
                        4.5
                    );
                }
            }
        }
    });

    it.each([
        // [chip token carrying the tinted background, token holding the light colour]
        // --color-state-danger is an alias of --color-accent-red, so the chip
        // background is read from the alias while the colour comes from its target.
        ['--color-accent-cyan', '--color-accent-cyan'],
        ['--color-accent-amber', '--color-accent-amber'],
        ['--color-accent-steel', '--color-accent-steel'],
        ['--color-accent-copper', '--color-accent-copper'],
        ['--color-accent-peach', '--color-accent-peach'],
        ['--color-accent-mint', '--color-accent-mint'],
        ['--color-accent-sage', '--color-accent-sage'],
        ['--color-accent-lavender', '--color-accent-lavender'],
        ['--color-accent-rose', '--color-accent-rose'],
        ['--color-accent-indigo', '--color-accent-indigo'],
        ['--color-state-danger', '--color-accent-red'],
    ])('keeps %s active-chip text above 4.75:1 on its actual tinted backgrounds', (chipToken, colorToken) => {
        const alphaSource = new RegExp(`bg-\\[var\\(${chipToken}\\)\\]/(\\d+)`, 'u').exec(chipSource)?.[1];
        if (alphaSource === undefined) {
            throw new Error(`Missing active-chip background for ${chipToken}`);
        }
        const accent = readToken(lightBlock, colorToken);
        for (const surfaceToken of [
            '--surface-deep',
            '--surface-base',
            '--surface-default',
            '--surface-raised',
            '--color-bg-well',
            '--color-bg-panelInset',
        ]) {
            const background = composite(accent, readToken(lightBlock, surfaceToken), Number(alphaSource) / 100);
            expect(contrast(accent, background)).toBeGreaterThanOrEqual(4.75);
        }
    });

    it('keeps Grinder chips and toggles readable on their real window and black-well backdrops', () => {
        const grinderSource = readFileSync(
            resolve(process.cwd(), 'src/modules/Grinder/presentations/views/GrinderPanel.tsx'),
            'utf8'
        );
        const grinderStyles = readFileSync(resolve(process.cwd(), 'src/styles/utilities/modules/grinder.css'), 'utf8');
        const toggleSource = readFileSync(resolve(process.cwd(), 'src/components/daw/DawPluginToggle.tsx'), 'utf8');
        expect(toggleSource).toMatch(/<DawPluginChip active=\{pressed\}[^>]*tone=\{tone\}/u);

        const windowBlock = /@utility grinder-window\s*\{([\s\S]*?)\n\}/u.exec(grinderStyles)?.[1] ?? '';
        expect(windowBlock).toContain('var(--color-bg-panelInset)');
        const rgbaLayers = Array.from(
            windowBlock.matchAll(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/gu),
            (match) => ({
                color: `#${match
                    .slice(1, 4)
                    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
                    .join('')}`,
                alpha: Number(match[4]),
            })
        );
        const [topWhite, , topAmber] = rgbaLayers;
        if (topWhite === undefined || topAmber === undefined) {
            throw new Error('Missing Grinder window gradient layers');
        }

        const panelInset = readToken(lightBlock, '--color-bg-panelInset');
        const windowTop = composite(
            topWhite.color,
            composite(topAmber.color, panelInset, topAmber.alpha),
            topWhite.alpha
        );
        const wellAlphaSource = /<div className="rounded-\[18px\][^"]*bg-black\/(\d+)[^"]*">/u.exec(grinderSource)?.[1];
        if (wellAlphaSource === undefined) {
            throw new Error('Missing Grinder snapshot well');
        }
        const blackWell = composite('#000000', windowTop, Number(wellAlphaSource) / 100);

        const usages = Array.from(
            grinderSource.matchAll(/<(DawPluginChip|DawPluginToggle)\b[^>]*?\btone="([a-z]+)"/gu),
            (match) => ({ component: match[1], tone: match[2] })
        ).filter(
            (usage, index, all) =>
                all.findIndex(
                    (candidate) => candidate.component === usage.component && candidate.tone === usage.tone
                ) === index
        );
        expect(usages).toContainEqual({ component: 'DawPluginChip', tone: 'amber' });
        expect(usages).toContainEqual({ component: 'DawPluginChip', tone: 'cyan' });
        expect(usages).toContainEqual({ component: 'DawPluginToggle', tone: 'cyan' });

        for (const { component, tone } of usages) {
            const token = `--color-accent-${tone}`;
            const alphaSource = new RegExp(`bg-\\[var\\(${token}\\)\\]/(\\d+)`, 'u').exec(chipSource)?.[1];
            if (alphaSource === undefined) {
                throw new Error(`Missing active-chip background for ${token}`);
            }
            const accent = readToken(lightBlock, token);
            const backdrops =
                component === 'DawPluginToggle' && tone === 'cyan' ? { windowTop, blackWell } : { windowTop };
            for (const [backdropName, backdrop] of Object.entries(backdrops)) {
                const background = composite(accent, backdrop, Number(alphaSource) / 100);
                expect(contrast(accent, background), `${component} ${tone} on ${backdropName}`).toBeGreaterThanOrEqual(
                    4.5
                );
            }
        }
    });
});

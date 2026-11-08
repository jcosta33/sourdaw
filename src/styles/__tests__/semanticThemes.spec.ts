import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { stringify } from 'superjson';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const chipSource = readFileSync(resolve(process.cwd(), 'src/components/daw/DawPluginChip.tsx'), 'utf8');
const lightBlock = /:root\.light\s*\{([^}]*)\}/u.exec(tokens)?.[1] ?? '';
const startupThemeMatch = /<script id="sourdaw-theme"([^>]*)>([\s\S]*?)<\/script>/u.exec(indexHtml);
const startupThemeSource = /\bsrc="([^"]+)"/u.exec(startupThemeMatch?.[1] ?? '')?.[1];
const startupThemeScript =
    startupThemeSource === '/themePrepaint.js'
        ? readFileSync(resolve(process.cwd(), 'public/themePrepaint.js'), 'utf8')
        : '';

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
        expect(startupThemeMatch?.[1]).toContain('src="/themePrepaint.js"');
        expect(startupThemeMatch?.[1]).not.toContain('defer');
        expect(startupThemeMatch?.[2]?.trim()).toBe('');
        expect(indexHtml.indexOf('id="sourdaw-theme"')).toBeLessThan(indexHtml.indexOf('id="sourdaw-entry"'));
        expect(indexHtml).toContain(':root.light');
    });

    it('restores the persisted light theme before startup paint', () => {
        const startup = runStartupTheme(stringify({ theme: 'light' }));

        expect(startup.classes).toEqual(new Set(['light']));
        expect(startup.colorScheme).toBe('light');
        expect(startup.themeColor).toBe('#f0ece5');
    });

    it('falls back to the dark startup when persisted preferences are corrupt', () => {
        const startup = runStartupTheme('{not-json');

        expect(startup.classes).toEqual(new Set(['dark']));
        expect(startup.colorScheme).toBe('dark');
        expect(startup.themeColor).toBe('#020100');
    });

    it.each(['--color-accent-cyan', '--color-accent-amber', '--color-accent-steel', '--color-accent-copper'])(
        'keeps %s active-chip text above 4.75:1 on its actual tinted backgrounds',
        (accentToken) => {
            const alphaSource = new RegExp(`bg-\\[var\\(${accentToken}\\)\\]/(\\d+)`, 'u').exec(chipSource)?.[1];
            if (alphaSource === undefined) {
                throw new Error(`Missing active-chip background for ${accentToken}`);
            }
            const accent = readToken(lightBlock, accentToken);
            for (const surfaceToken of [
                '--surface-deep',
                '--surface-base',
                '--surface-default',
                '--surface-raised',
                '--color-bg-well',
            ]) {
                const background = composite(accent, readToken(lightBlock, surfaceToken), Number(alphaSource) / 100);
                expect(contrast(accent, background)).toBeGreaterThanOrEqual(4.75);
            }
        }
    );
});

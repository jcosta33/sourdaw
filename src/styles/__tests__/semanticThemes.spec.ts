import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { parse, stringify } from 'superjson';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const chipSource = readFileSync(resolve(process.cwd(), 'src/components/daw/DawPluginChip.tsx'), 'utf8');
const ledSource = readFileSync(resolve(process.cwd(), 'src/components/daw/DawPluginLed.tsx'), 'utf8');
const meteringSource = readFileSync(
    resolve(process.cwd(), 'src/modules/Crust/presentations/components/CrustMeteringStrip.tsx'),
    'utf8'
);
const meterColorSource = readFileSync(
    resolve(process.cwd(), 'src/modules/Crust/presentations/components/crustMeterColors.ts'),
    'utf8'
);
const lightBlock = /:root\.light\s*\{([^}]*)\}/u.exec(tokens)?.[1] ?? '';
const indexDocument = new DOMParser().parseFromString(indexHtml, 'text/html');
const findThemeScript = (html: string): HTMLScriptElement | null => {
    const scripts = new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelectorAll<HTMLScriptElement>('script#sourdaw-theme');
    return [...scripts].find((script) => script.closest('noscript, template') === null) ?? null;
};
const startupThemeMatch = findThemeScript(indexHtml);
const startupThemeSource = startupThemeMatch?.getAttribute('src');
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
        expect(startupThemeMatch?.getAttribute('src')).toBe('/themePrepaint.js');
        // An absent or non-JavaScript type can suppress execution; module,
        // async or defer spelling defers the prepaint past first paint and
        // restores the dark flash it exists to prevent.
        expect(startupThemeMatch?.getAttribute('type')?.toLowerCase()).toBe('text/javascript');
        expect(startupThemeMatch?.getAttribute('type')?.toLowerCase()).not.toBe('module');
        expect(startupThemeMatch?.hasAttribute('async')).toBe(false);
        expect(startupThemeMatch?.hasAttribute('defer')).toBe(false);
        expect(startupThemeMatch?.textContent?.trim()).toBe('');
        const entryScript = indexDocument.querySelector<HTMLScriptElement>('script#sourdaw-entry');
        if (startupThemeMatch === null || entryScript === null) {
            throw new Error('Expected active theme and entry scripts');
        }
        expect(
            startupThemeMatch.compareDocumentPosition(entryScript) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeGreaterThan(0);
        expect(indexHtml).toContain(':root.light');
    });

    it.each([
        {
            name: 'commented-out markup',
            html: '<!-- <script id="sourdaw-theme" type="text/javascript" src="/themePrepaint.js"></script> -->',
        },
        {
            name: 'a scripting-inert noscript ancestor',
            html: '<body><noscript><script id="sourdaw-theme" type="text/javascript" src="/themePrepaint.js"></script></noscript></body>',
        },
    ])('does not accept $name as active markup', ({ html }) => {
        expect(findThemeScript(html)).toBeNull();
        expect(findThemeScript(indexHtml)).not.toBeNull();
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

    it.each([
        { name: 'ordinary valid Light', stored: stringify({ theme: 'light' }) },
        { name: 'ordinary valid Dark', stored: stringify({ theme: 'dark' }) },
        {
            name: 'direct theme value annotation',
            stored: '{"json":{"theme":"light"},"meta":{"values":{"theme":["number"]}}}',
        },
        {
            name: 'root value annotation',
            stored: '{"json":{"theme":"light"},"meta":{"values":["number"],"v":1}}',
        },
        {
            name: 'theme-affecting referential equality',
            stored: '{"json":{"theme":"light","other":{"theme":"dark"}},"meta":{"referentialEqualities":{"other":["theme"]},"v":1}}',
        },
        {
            name: 'root referential equality retargeting theme',
            stored: '{"json":{"theme":"light","other":"dark"},"meta":{"referentialEqualities":[["theme"]],"v":1}}',
        },
        {
            name: 'unrelated field value metadata',
            stored: stringify({ theme: 'light', elasticTransientSensitivity: Number.NaN }),
        },
        {
            name: 'unrelated referential metadata',
            stored: '{"json":{"theme":"light","other":{"value":1},"copy":null},"meta":{"referentialEqualities":{"other":["copy"]},"v":1}}',
        },
        {
            name: 'unrelated root referential metadata',
            stored: '{"json":{"theme":"light","other":null},"meta":{"referentialEqualities":[["other"]],"v":1}}',
        },
        {
            name: 'inert nested theme annotation shape',
            stored: '{"json":{"theme":"light"},"meta":{"values":{"theme":null}}}',
        },
        { name: 'absent metadata envelope', stored: '{"json":{"theme":"light"},"meta":null}' },
        {
            name: 'malformed referential target',
            stored: '{"json":{"theme":"light","other":null},"meta":{"referentialEqualities":{"other":null},"v":1}}',
        },
    ])('keeps every startup channel aligned with runtime validation for $name', ({ stored }) => {
        let decoded: unknown;
        try {
            decoded = parse(stored);
        } catch {
            decoded = undefined;
        }
        const decodedTheme =
            typeof decoded === 'object' && decoded !== null && 'theme' in decoded ? decoded.theme : undefined;
        const validatedTheme = decodedTheme === 'light' ? 'light' : 'dark';

        expect(runStartupTheme(stored)).toEqual({
            classes: new Set([validatedTheme]),
            colorScheme: validatedTheme,
            themeColor: validatedTheme === 'light' ? '#ded8cf' : '#020100',
        });
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

    it('keeps the nested neutral Crust status readable in both themes', () => {
        const neutralClasses = /\bneutral:\s*'([^']+)'/u.exec(ledSource)?.[1] ?? '';
        expect(neutralClasses).toContain('bg-surface-default');
        expect(neutralClasses).toContain('text-text-secondary');
        expect(neutralClasses).not.toContain('text-white');

        for (const themeBlock of [tokens, lightBlock]) {
            const foreground = readToken(themeBlock, '--color-text-secondary');
            const background = readToken(themeBlock, '--surface-default');
            expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('keeps the plain-text Crust channel labels readable on their raised surface', () => {
        const labels = Array.from(meteringSource.matchAll(/<span className="([^"]*)">([LR])<\/span>/gu), (match) => ({
            className: match[1] ?? '',
            label: match[2],
        }));
        expect(labels.map(({ label }) => label)).toEqual(['L', 'R']);

        for (const { className } of labels) {
            expect(className).toContain('text-muted-foreground');
            expect(className).not.toContain('text-muted-foreground/');
        }
        for (const themeBlock of [tokens, lightBlock]) {
            const foreground = readToken(themeBlock, '--color-text-secondary');
            const background = readToken(themeBlock, '--surface-raised');
            expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('keeps normal Crust GR text readable while preserving semantic state colors', () => {
        const grTextSource = /export function grTextColor\(gr: number\): string \{([\s\S]*?)\n\}/u.exec(
            meterColorSource
        )?.[1];
        expect(grTextSource).toContain("return 'var(--color-text-primary)';");
        expect(meteringSource).toContain('const grTextColorValue = grTextColor(grDb);');
        expect(meteringSource).toContain('style={{ color: grTextColorValue }}');

        for (const themeBlock of [tokens, lightBlock]) {
            const foreground = readToken(themeBlock, '--color-text-primary');
            const background = readToken(themeBlock, '--surface-raised');
            expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
        const background = readToken(lightBlock, '--surface-raised');
        for (const foreground of ['--color-accent-amber', '--color-accent-orange', '--color-accent-red']) {
            expect(contrast(readToken(lightBlock, foreground), background)).toBeGreaterThanOrEqual(4.5);
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

    it('keeps every Grinder plain-text route semantic and readable on its real Light surfaces', () => {
        const grinderSource = readFileSync(
            resolve(process.cwd(), 'src/modules/Grinder/presentations/views/GrinderPanel.tsx'),
            'utf8'
        );
        const importedSource = readFileSync(
            resolve(process.cwd(), 'src/modules/Grinder/presentations/components/ImportedNeuralLibraryCard.tsx'),
            'utf8'
        );
        const grinderStyles = readFileSync(resolve(process.cwd(), 'src/styles/utilities/modules/grinder.css'), 'utf8');
        for (const source of [grinderSource, importedSource]) {
            expect(source).not.toMatch(/\btext-white\//u);
            expect(source).toContain('text-text-primary');
        }
        expect(grinderSource).toContain('text-text-secondary');
        expect(grinderSource).not.toMatch(/bg-black\/20 px-3 py-2\.5">\s*<div className="[^"]*text-text-secondary/u);
        expect(grinderStyles).toMatch(/@utility grinder-tab\s*\{[^}]*color:\s*var\(--color-text-primary\);/u);
        expect(grinderSource).toContain('rounded-[20px] border border-white/8 bg-black/30 p-4');

        const primary = readToken(lightBlock, '--color-text-primary');
        const secondary = readToken(lightBlock, '--color-text-secondary');
        const panelInset = readToken(lightBlock, '--color-bg-panelInset');
        const windowBlock = /@utility grinder-window\s*\{([\s\S]*?)\n\}/u.exec(grinderStyles)?.[1] ?? '';
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
        const [topWhite, bottomWhite, topAmber] = rgbaLayers;
        if (topWhite === undefined || bottomWhite === undefined || topAmber === undefined) {
            throw new Error('Missing Grinder window gradient layers');
        }
        const amberBase = (alpha: number) => composite(topAmber.color, panelInset, alpha);
        const windowTop = composite(topWhite.color, amberBase(topAmber.alpha), topWhite.alpha);
        const windowMiddle = composite(
            topWhite.color,
            amberBase(topAmber.alpha / 2),
            (topWhite.alpha + bottomWhite.alpha) / 2
        );
        const windowBottom = composite(bottomWhite.color, panelInset, bottomWhite.alpha);
        for (const [surfaceName, background] of Object.entries({
            panelInset,
            windowTop,
            windowMiddle,
            windowBottom,
        })) {
            for (const [role, foreground] of Object.entries({ primary, secondary })) {
                expect(contrast(foreground, background), `${role} on ${surfaceName}`).toBeGreaterThanOrEqual(4.5);
            }
        }
        for (const alpha of [16, 18, 20, 24, 25, 30]) {
            const background = composite('#000000', windowTop, alpha / 100);
            expect(contrast(primary, background), `primary on black/${alpha} well`).toBeGreaterThanOrEqual(4.5);
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
        expect(usages).toContainEqual({ component: 'DawPluginToggle', tone: 'amber' });
        expect(grinderSource).toMatch(
            /<div\s+key=\{`chain-[^`]+`\}\s+className="rounded-\[18px\][^"]*bg-black\/20[^"]*"[^>]*>[\s\S]*?<DawPluginToggle\b[^>]*?\btone="amber"/u
        );

        for (const { component, tone } of usages) {
            const token = `--color-accent-${tone}`;
            const alphaSource = new RegExp(`bg-\\[var\\(${token}\\)\\]/(\\d+)`, 'u').exec(chipSource)?.[1];
            if (alphaSource === undefined) {
                throw new Error(`Missing active-chip background for ${token}`);
            }
            const accent = readToken(lightBlock, token);
            const toggleInWell = component === 'DawPluginToggle' && (tone === 'cyan' || tone === 'amber');
            const backdrops = toggleInWell ? { windowTop, blackWell } : { windowTop };
            for (const [backdropName, backdrop] of Object.entries(backdrops)) {
                const background = composite(accent, backdrop, Number(alphaSource) / 100);
                expect(contrast(accent, background), `${component} ${tone} on ${backdropName}`).toBeGreaterThanOrEqual(
                    4.5
                );
            }
        }
    });
});

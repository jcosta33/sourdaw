import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DawCompactTextarea } from '#/components/daw/DawCompactTextarea';
import { DawDiagramFrame } from '#/components/daw/DawDiagramFrame';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawSearchInput } from '#/components/daw/DawSearchInput';
import { Input } from '#/components/ui/input';

const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const chipSource = readFileSync(resolve(process.cwd(), 'src/components/daw/DawPluginChip.tsx'), 'utf8');
const ledSource = readFileSync(resolve(process.cwd(), 'src/components/daw/DawPluginLed.tsx'), 'utf8');
const automationSource = readFileSync(
    resolve(process.cwd(), 'src/modules/TimelineEditor/presentations/views/AutomationView/AutomationControls.tsx'),
    'utf8'
);
const bacteriaSources = [
    'src/modules/Bacteria/presentations/views/BacteriaPanel.tsx',
    'src/modules/Bacteria/presentations/components/ModulationDock.tsx',
    'src/modules/Bacteria/presentations/components/StepSequencerEditor.tsx',
    'src/modules/Bacteria/presentations/components/CrossoverDisplay.tsx',
    'src/modules/Bacteria/presentations/components/BandStrip.tsx',
    'src/modules/Bacteria/presentations/components/BezierLfoEditor.tsx',
    'src/modules/Bacteria/presentations/components/WaveshaperEditor.tsx',
    'src/modules/Bacteria/presentations/components/SpectralBinEditor.tsx',
    'src/modules/Bacteria/presentations/components/XYMorphPad.tsx',
].map((path) => ({ path, source: readFileSync(resolve(process.cwd(), path), 'utf8') }));
const gainSource = readFileSync(
    resolve(process.cwd(), 'src/modules/Crust/presentations/components/CrustGainStrip.tsx'),
    'utf8'
);
const controlZoneSource = readFileSync(
    resolve(process.cwd(), 'src/modules/Crust/presentations/components/CrustControlZone.tsx'),
    'utf8'
);
const crustPanelSource = readFileSync(
    resolve(process.cwd(), 'src/modules/Crust/presentations/views/CrustPanel.tsx'),
    'utf8'
);
const proofChamberSource = readFileSync(
    resolve(process.cwd(), 'src/modules/ProofChamber/presentations/views/ProofChamberPanel.tsx'),
    'utf8'
);
const tunerSource = readFileSync(
    resolve(process.cwd(), 'src/modules/Tuner/presentations/views/TunerPanel.tsx'),
    'utf8'
);
const mainStyles = readFileSync(resolve(process.cwd(), 'src/styles/main.css'), 'utf8');
const meteringSource = readFileSync(
    resolve(process.cwd(), 'src/modules/Crust/presentations/components/CrustMeteringStrip.tsx'),
    'utf8'
);
const meterColorSource = readFileSync(
    resolve(process.cwd(), 'src/modules/Crust/presentations/components/crustMeterColors.ts'),
    'utf8'
);
const lightBlock = /:root\.light\s*\{([^}]*)\}/u.exec(tokens)?.[1] ?? '';
/** Parse with the browser's scripting flag so noscript contents stay inert. */
const parseActiveHtml = (html: string): Document => {
    const parsed = document.implementation.createHTMLDocument('');
    parsed.open();
    parsed.write(html);
    parsed.close();
    return parsed;
};
const htmlThemeScriptFrom = (parsed: Document): HTMLScriptElement | null =>
    [...parsed.querySelectorAll<HTMLScriptElement>('script#sourdaw-theme')].find(
        (script) => script.namespaceURI === 'http://www.w3.org/1999/xhtml'
    ) ?? null;
const indexDocument = parseActiveHtml(indexHtml);
const findThemeScript = (html: string): HTMLScriptElement | null => htmlThemeScriptFrom(parseActiveHtml(html));
const startupThemeMatch = htmlThemeScriptFrom(indexDocument);

const entryModuleFrom = (parsed: Document): HTMLScriptElement | null =>
    [...parsed.querySelectorAll<HTMLScriptElement>('script[type="module" i][src]')].findLast(
        (script) => script.namespaceURI === 'http://www.w3.org/1999/xhtml'
    ) ?? null;
const themePrecedesEntry = (theme: HTMLScriptElement | null, entry: Element | null): boolean => {
    if (theme === null || entry === null) {
        throw new Error('Expected active theme and entry target');
    }
    const themeRoot = theme.getRootNode();
    if (themeRoot !== entry.getRootNode() || themeRoot !== theme.ownerDocument) {
        throw new Error('Theme and entry target must share one connected document');
    }
    return (theme.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
};

const readToken = (source: string, name: string): string => {
    const value = new RegExp(`${name}:\\s*([^;]+);`, 'u').exec(source)?.[1];
    if (value === undefined) {
        throw new Error(`Missing ${name}`);
    }
    return value.trim();
};

const readLightColor = (token: string): string => {
    const value = new RegExp(`${token}:\\s*([^;]+);`, 'u').exec(lightBlock)?.[1] ?? readToken(tokens, token);
    const alias = /^var\((--[a-z-]+)\)$/iu.exec(value.trim())?.[1];
    return alias === undefined ? value.trim() : readLightColor(alias);
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

type CssColor = { color: string; alpha: number };

const parseCssColor = (value: string): CssColor => {
    const token = /^var\((--[a-z-]+)\)$/iu.exec(value.trim())?.[1];
    const resolved = token === undefined ? value.trim() : readLightColor(token);
    if (/^#[0-9a-f]{6}$/iu.test(resolved)) {
        return { color: resolved, alpha: 1 };
    }
    const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/u.exec(resolved);
    if (rgba !== null) {
        return {
            color: `#${rgba
                .slice(1, 4)
                .map((channel) => Number(channel).toString(16).padStart(2, '0'))
                .join('')}`,
            alpha: Number(rgba[4]),
        };
    }
    throw new Error(`Unsupported CSS color: ${value}`);
};

const utilityBlock = (utility: string): string =>
    new RegExp(`@utility ${utility}\\s*\\{([\\s\\S]*?)\\n\\}`, 'u').exec(mainStyles)?.[1] ?? '';

type MainWindowStops = {
    windowTop: string;
    windowAccentFade: string;
    windowBottom: string;
};

const mainWindowStops = (utility: string): MainWindowStops => {
    const windowBlock = utilityBlock(utility);
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
    const [topWhite, bottomWhite, topAccent] = rgbaLayers;
    const fadeEndpoint = Number(/transparent\s+([\d.]+)%/u.exec(windowBlock)?.[1]);
    if (
        topWhite === undefined ||
        bottomWhite === undefined ||
        topAccent === undefined ||
        !Number.isFinite(fadeEndpoint)
    ) {
        throw new Error(`Missing ${utility} gradient layers or accent fade endpoint`);
    }
    const panelInset = readToken(lightBlock, '--color-bg-panelInset');
    const fadeWhiteAlpha = topWhite.alpha + (bottomWhite.alpha - topWhite.alpha) * (fadeEndpoint / 100);
    const overPanel = (white: { color: string; alpha: number }, accentAlpha: number): string =>
        composite(white.color, composite(topAccent.color, panelInset, accentAlpha), white.alpha);
    return {
        windowTop: overPanel(topWhite, topAccent.alpha),
        windowAccentFade: overPanel({ color: topWhite.color, alpha: fadeWhiteAlpha }, 0),
        windowBottom: overPanel(bottomWhite, 0),
    };
};

const grinderWindowStops = (): MainWindowStops => mainWindowStops('grinder-window');
const crustWindowStops = (): MainWindowStops => mainWindowStops('crust-window');

const grinderFaceplateStops = (): Record<string, string> => {
    const layers = Array.from(
        utilityBlock('grinder-faceplate').matchAll(/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/gu),
        (match) => parseCssColor(match[0])
    );
    const [topWhite, bottomWhite, accent] = layers;
    if (topWhite === undefined || bottomWhite === undefined || accent === undefined) {
        throw new Error('Missing Grinder faceplate gradient layers');
    }
    const raised = readLightColor('--color-bg-panelRaised');
    const panel = readLightColor('--color-bg-panel');
    return {
        faceplateTop: composite(topWhite.color, composite(accent.color, raised, accent.alpha), topWhite.alpha),
        faceplateBottom: composite(bottomWhite.color, panel, bottomWhite.alpha),
    };
};

describe('semantic light theme', () => {
    it('keeps Automation labels, counts, icons, and empty states opaque on every floating-surface stop', () => {
        const markup = renderToStaticMarkup(createElement(DawEyebrowLabel, null, 'Add parameter'));
        const eyebrow = parseActiveHtml(markup).querySelector('span');
        expect(eyebrow).not.toBeNull();
        expect(eyebrow?.getAttribute('class')).toContain('text-muted-foreground');
        expect(eyebrow?.getAttribute('class')).not.toContain('text-muted-foreground/');
        expect(automationSource).not.toMatch(/\btext-muted-foreground\/\d+/u);

        const muted = readLightColor('--color-muted-foreground');
        for (const [stop, background] of Object.entries(mainWindowStops('daw-floating-surface'))) {
            expect(contrast(muted, background), `Automation muted text on ${stop}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('keeps every Bacteria text role opaque and readable on every real Light window stop', () => {
        for (const { path, source } of bacteriaSources) {
            expect(source, `${path} alpha-reduced text`).not.toMatch(
                /\btext-(?:foreground|muted-foreground|\[var\(--color-[a-z-]+\)\]|rose-400)\/\d+/u
            );
            expect(source, `${path} raw Light-unaware text`).not.toMatch(/\btext-(?:rose-400|white)\b/u);
        }
        const modulationSource = bacteriaSources.find(({ path }) => path.endsWith('ModulationDock.tsx'))?.source ?? '';
        const crossoverSource = bacteriaSources.find(({ path }) => path.endsWith('CrossoverDisplay.tsx'))?.source ?? '';
        expect(modulationSource).toContain('color: source.textColor');
        expect(modulationSource).toContain("source?.textColor ?? 'var(--color-text-primary)'");
        expect(modulationSource).not.toContain('text-[6px] opacity-50');
        expect(crossoverSource).not.toContain('style={{ color: BAND_BORDER_COLORS');

        const stops = mainWindowStops('bacteria-window');
        for (const token of [
            '--color-text-primary',
            '--color-text-secondary',
            '--color-accent-mint',
            '--color-accent-rose',
            '--color-accent-orange',
            '--color-accent-lavender',
            '--color-accent-steel',
            '--color-accent-amber',
        ]) {
            const foreground = readLightColor(token);
            for (const [stop, background] of Object.entries(stops)) {
                expect(contrast(foreground, background), `${token} on Bacteria ${stop}`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

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

    it('loads the prepaint theme before the startup main and entry module without blocking either', () => {
        expect(startupThemeMatch?.getAttribute('src')).toBe('/themePrepaint.js');
        // An absent or non-JavaScript type can suppress execution. Async lets
        // the parser reach the static startup markup; the hidden root and the
        // script's insertion observer still prevent an unthemed first paint.
        expect(startupThemeMatch?.getAttribute('type')?.toLowerCase()).toBe('text/javascript');
        expect(startupThemeMatch?.getAttribute('type')?.toLowerCase()).not.toBe('module');
        expect(startupThemeMatch?.hasAttribute('async')).toBe(true);
        expect(startupThemeMatch?.hasAttribute('defer')).toBe(false);
        expect(startupThemeMatch?.textContent?.trim()).toBe('');
        expect(themePrecedesEntry(startupThemeMatch, indexDocument.getElementById('entry-startup'))).toBe(true);
        expect(themePrecedesEntry(startupThemeMatch, entryModuleFrom(indexDocument))).toBe(true);
        expect(indexHtml).toContain(':root.light');
    });

    it('detects reversed real theme and entry tags in one connected document', () => {
        const themeTag = '<script id="sourdaw-theme" type="text/javascript" src="/themePrepaint.js" async></script>';
        const entryTag = '<script id="sourdaw-entry" type="module" src="/src/app/main.tsx"></script>';
        expect(indexHtml).toContain(themeTag);
        expect(indexHtml).toContain(entryTag);
        const reversedHtml = indexHtml
            .replace(themeTag, '__THEME_TAG__')
            .replace(entryTag, themeTag)
            .replace('__THEME_TAG__', entryTag);
        const reversedDocument = parseActiveHtml(reversedHtml);

        expect(themePrecedesEntry(htmlThemeScriptFrom(reversedDocument), entryModuleFrom(reversedDocument))).toBe(
            false
        );
        expect(() => themePrecedesEntry(startupThemeMatch, entryModuleFrom(parseActiveHtml(indexHtml)))).toThrow(
            'one connected document'
        );
    });

    it.each([
        {
            name: 'commented-out markup',
            html: '<!-- <script id="sourdaw-theme" type="text/javascript" src="/themePrepaint.js"></script> -->',
        },
        {
            name: 'a scripting-inert head noscript ancestor',
            html: '<head><noscript><script id="sourdaw-theme" type="text/javascript" src="/themePrepaint.js"></script></noscript></head>',
        },
        {
            name: 'a scripting-inert body noscript ancestor',
            html: '<body><noscript><script id="sourdaw-theme" type="text/javascript" src="/themePrepaint.js"></script></noscript></body>',
        },
        {
            name: 'an SVG script',
            html: '<svg><script id="sourdaw-theme" type="text/javascript" src="/themePrepaint.js"></script></svg>',
        },
    ])('does not accept $name as active markup', ({ html }) => {
        expect(findThemeScript(html)).toBeNull();
        expect(findThemeScript(indexHtml)).not.toBeNull();
    });

    const renderedPlaceholderClass = ({
        variant = 'default',
        inputClassName,
    }: {
        variant?: 'default' | 'ghost';
        inputClassName?: string;
    } = {}): string => {
        const markup = renderToStaticMarkup(
            createElement(DawSearchInput, { value: '', onChange: () => undefined, variant, inputClassName })
        );
        const input = parseActiveHtml(markup).querySelector('input');
        if (input === null) {
            throw new Error('Expected the real search input to render');
        }
        const placeholderClass = (input.getAttribute('class') ?? '')
            .split(/\s+/u)
            .findLast((name) => name.startsWith('placeholder:text-'));
        if (placeholderClass === undefined) {
            throw new Error('Missing final search placeholder foreground class');
        }
        return placeholderClass;
    };

    const placeholderColor = (placeholderClass: string, background: string): string => {
        const match = /^placeholder:text-(muted-foreground|text-primary)(?:\/(\d+))?$/u.exec(placeholderClass);
        if (match === null) {
            throw new Error(`Unsupported search placeholder foreground: ${placeholderClass}`);
        }
        const token = match[1] === 'muted-foreground' ? '--color-muted-foreground' : '--color-text-primary';
        const foreground = readLightColor(token);
        return match[2] === undefined ? foreground : composite(foreground, background, Number(match[2]) / 100);
    };

    it('keeps the shared default search placeholder opaque and readable on its inset surface', () => {
        const placeholderClass = renderedPlaceholderClass();
        expect(placeholderClass).toBe('placeholder:text-muted-foreground');

        const background = readLightColor('--color-bg-panelInset');
        expect(contrast(placeholderColor(placeholderClass, background), background)).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the Browser ghost search placeholder opaque and readable on its base surface', () => {
        const browserSource = readFileSync(
            resolve(process.cwd(), 'src/modules/ContentBrowser/presentations/views/Sidebar.tsx'),
            'utf8'
        );
        const [, headerClass = '', searchRoute = ''] =
            /<Row\b[^>]*className="([^"]*)"[^>]*>\s*(<DawSearchInput\b[^>]*placeholder="Search library\.\.\."[^>]*\/>)/u.exec(
                browserSource
            ) ?? [];
        expect(headerClass).toContain('bg-surface-base');
        expect(headerClass).not.toContain('bg-surface-base/');
        expect(searchRoute).toContain('variant="ghost"');
        const routeInputClass = /\binputClassName="([^"]*)"/u.exec(searchRoute)?.[1];
        const placeholderClass = renderedPlaceholderClass({ variant: 'ghost', inputClassName: routeInputClass });
        expect(placeholderClass).toBe('placeholder:text-muted-foreground');

        const background = readLightColor('--surface-base');
        expect(contrast(placeholderColor(placeholderClass, background), background)).toBeGreaterThanOrEqual(4.5);
    });

    const controlForeground = (foregroundClass: string, background: string): string => {
        const match = /^(?:placeholder:)?text-(white|muted-foreground|text-primary|text-disabled)(?:\/(\d+))?$/u.exec(
            foregroundClass
        );
        if (match === null) {
            throw new Error(`Unsupported control foreground: ${foregroundClass}`);
        }
        const foreground = match[1] === 'white' ? '#ffffff' : readLightColor(`--color-${match[1]}`);
        return match[2] === undefined ? foreground : composite(foreground, background, Number(match[2]) / 100);
    };

    const diagramTitleClasses = (titleClassName?: string): string[] => {
        const markup = renderToStaticMarkup(createElement(DawDiagramFrame, { title: 'Signal flow', titleClassName }));
        const title = [...parseActiveHtml(markup).querySelectorAll('span')].find(
            (span) => span.textContent === 'Signal flow'
        );
        if (title === undefined) {
            throw new Error('Expected the diagram title to render');
        }
        return (title.getAttribute('class') ?? '').split(/\s+/u).filter(Boolean);
    };

    const dawInsetSurfaceStops = (): Record<string, string> => {
        const backgroundSource =
            /background:([\s\S]*?);\n {4}border:/u.exec(utilityBlock('daw-inset-surface'))?.[1] ?? '';
        const layers = Array.from(backgroundSource.matchAll(/rgba\([^)]*\)/gu), (match) => parseCssColor(match[0]));
        const [topWhite, bottomWhite, topBlack] = layers;
        const fadeEndpoint = Number(/transparent\s+([\d.]+)%/u.exec(backgroundSource)?.[1]);
        if (
            topWhite === undefined ||
            bottomWhite === undefined ||
            topBlack === undefined ||
            !Number.isFinite(fadeEndpoint)
        ) {
            throw new Error('Missing daw-inset-surface gradient layers');
        }
        const panelInset = readToken(lightBlock, '--color-bg-panelInset');
        const at = (position: number): string => {
            const whiteAlpha = topWhite.alpha + (bottomWhite.alpha - topWhite.alpha) * (position / 100);
            const blackAlpha = topBlack.alpha * Math.max(0, 1 - position / fadeEndpoint);
            return composite(topWhite.color, composite(topBlack.color, panelInset, blackAlpha), whiteAlpha);
        };
        return { top: at(0), center: at(50), bottom: at(100) };
    };

    it('keeps diagram titles readable on both real header stops and preserves caller overrides', () => {
        const titleClasses = diagramTitleClasses();
        const foregroundClass = titleClasses.findLast((name) =>
            /^text-(?:white|muted-foreground|text-primary)(?:\/\d+)?$/u.test(name)
        );
        if (foregroundClass === undefined) {
            throw new Error('Missing final diagram title foreground');
        }
        const stopTokens = Array.from(
            utilityBlock('daw-header-band').matchAll(/var\((--[a-z-]+)\)\s+(?:0|100)%/giu),
            (match) => match[1]
        );
        expect(stopTokens).toEqual(['--color-bg-panelInset', '--color-bg-well']);
        for (const token of stopTokens) {
            const background = readLightColor(token ?? '');
            expect(contrast(controlForeground(foregroundClass, background), background)).toBeGreaterThanOrEqual(4.5);
        }
        expect(foregroundClass).toBe('text-muted-foreground');

        const overrideClasses = diagramTitleClasses('text-text-primary');
        expect(overrideClasses).toContain('text-text-primary');
        expect(overrideClasses).not.toContain('text-muted-foreground');
    });

    it('keeps compact textarea placeholders opaque and readable on their actual inset surface', () => {
        const markup = renderToStaticMarkup(createElement(DawCompactTextarea, { placeholder: 'Track notes' }));
        const textarea = parseActiveHtml(markup).querySelector('textarea');
        if (textarea === null) {
            throw new Error('Expected the compact textarea to render');
        }
        const classes = (textarea.getAttribute('class') ?? '').split(/\s+/u).filter(Boolean);
        expect(classes).toContain('bg-surface-inset');
        const foregroundClass = classes.findLast((name) => name.startsWith('placeholder:text-'));
        if (foregroundClass === undefined) {
            throw new Error('Missing final compact textarea placeholder foreground');
        }
        const background = readLightColor('--color-surface-inset');
        expect(contrast(controlForeground(foregroundClass, background), background)).toBeGreaterThanOrEqual(4.5);
        expect(foregroundClass).toBe('placeholder:text-muted-foreground');
    });

    it('keeps enabled input placeholders readable on the top, center, and bottom inset stops', () => {
        const markup = renderToStaticMarkup(createElement(Input, { placeholder: 'Buffer size' }));
        const input = parseActiveHtml(markup).querySelector('input');
        if (input === null) {
            throw new Error('Expected the shared input to render');
        }
        const classes = (input.getAttribute('class') ?? '').split(/\s+/u).filter(Boolean);
        expect(classes).toContain('daw-inset-surface');
        const foregroundClass = classes.findLast((name) => name.startsWith('placeholder:text-'));
        if (foregroundClass === undefined) {
            throw new Error('Missing final shared input placeholder foreground');
        }
        for (const [stop, background] of Object.entries(dawInsetSurfaceStops())) {
            expect(
                contrast(controlForeground(foregroundClass, background), background),
                `Shared input placeholder on ${stop}`
            ).toBeGreaterThanOrEqual(4.5);
        }
        expect(foregroundClass).toBe('placeholder:text-text-primary');
    });

    it('keeps Preferences grid group labels readable on the dialog’s actual composite surface', () => {
        const preferencesSource = readFileSync(
            resolve(process.cwd(), 'src/modules/Preferences/presentations/views/PreferencesDialog.tsx'),
            'utf8'
        );
        const dialogSource = readFileSync(resolve(process.cwd(), 'src/components/ui/dialog.tsx'), 'utf8');
        const preferencesSharedSource = readFileSync(
            resolve(process.cwd(), 'src/modules/Preferences/presentations/views/preferencesShared.tsx'),
            'utf8'
        );
        expect(preferencesSource).toContain('<DialogContent size="workspace">');
        const workspaceClass = /workspace:\s*'([^']*)'/u.exec(dialogSource)?.[1] ?? '';
        expect(workspaceClass).toContain('bg-surface-raised');
        expect(workspaceClass).not.toContain('bg-surface-raised/');
        const bodyClass = /<DawDialogBody\b[^>]*className="([^"]*)"/u.exec(preferencesSource)?.[1] ?? '';
        const bodyAlphaSource = /\bbg-surface-base\/(\d+)/u.exec(bodyClass)?.[1];
        if (bodyAlphaSource === undefined) {
            throw new Error('Missing Preferences dialog body surface and alpha');
        }
        const labelClass = /<span className="([^"]*)">\{group\.label\}<\/span>/u.exec(preferencesSharedSource)?.[1];
        const mutedClass = /\btext-muted-foreground(?:\/(\d+))?\b/u.exec(labelClass ?? '');
        if (mutedClass === null) {
            throw new Error('Missing Preferences grid group muted foreground');
        }

        const background = composite(
            readLightColor('--surface-base'),
            readLightColor('--surface-raised'),
            Number(bodyAlphaSource) / 100
        );
        const muted = readLightColor('--color-muted-foreground');
        const foreground =
            mutedClass[1] === undefined ? muted : composite(muted, background, Number(mutedClass[1]) / 100);
        expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the Grinder preset search placeholder readable on every real nested window stop', () => {
        const grinderSource = readFileSync(
            resolve(process.cwd(), 'src/modules/Grinder/presentations/views/GrinderPanel.tsx'),
            'utf8'
        );
        const searchRoute =
            /<DawSearchInput\b[^>]*placeholder="Search presets"[^>]*\/>/u.exec(grinderSource)?.[0] ?? '';
        expect(searchRoute).toContain('variant="ghost"');
        const wellAlphaSource = /bg-black\/(\d+)/u.exec(searchRoute)?.[1];
        expect(wellAlphaSource).toBeDefined();

        const routeInputClass = /\binputClassName="([^"]*)"/u.exec(searchRoute)?.[1];
        const effectivePlaceholderClass = renderedPlaceholderClass({
            variant: 'ghost',
            inputClassName: routeInputClass,
        });
        expect(effectivePlaceholderClass).toMatch(/^placeholder:text-text-primary(?:\/\d+)?$/u);

        for (const [stop, windowBackground] of Object.entries(grinderWindowStops())) {
            const background = composite('#000000', windowBackground, Number(wellAlphaSource) / 100);
            const foreground = placeholderColor(effectivePlaceholderClass, background);
            expect(contrast(foreground, background), `Search presets on ${stop}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('keeps Crust metric rows and captions readable on every real gradient stop', () => {
        const metricWrapper =
            /<DawPluginMetricTile className="([^"]+)" label=\{label\} value=\{value\} detail=\{detail\} \/>/u.exec(
                crustPanelSource
            )?.[0] ?? '';
        expect(metricWrapper).toContain('crust-window');
        expect(metricWrapper).not.toMatch(/labelClassName|detailClassName/u);
        for (const label of ['Push', 'Shave', 'Target', 'Penalty']) {
            expect(crustPanelSource).toMatch(new RegExp(`<MetricTile\\s+label="${label}"`, 'u'));
        }

        const markup = renderToStaticMarkup(
            createElement(DawPluginMetricTile, {
                className: 'crust-window min-w-[92px]',
                label: 'Push',
                value: '1.0 dB',
                detail: 'Input shove',
            })
        );
        const spans = [...parseActiveHtml(markup).querySelectorAll('span')];
        const rows = [
            { role: 'Metric label', className: spans[0]?.getAttribute('class') ?? '' },
            { role: 'Metric detail', className: spans[2]?.getAttribute('class') ?? '' },
        ];
        const captions = Array.from(
            crustPanelSource.matchAll(/className="([^"]*)">\s*(Preset|Target|Ceiling)\s*<\/(?:div|span)>/gu),
            (match) => ({ role: `${match[2]} caption`, className: match[1] ?? '' })
        );
        expect(captions.map((caption) => caption.role)).toEqual([
            'Preset caption',
            'Target caption',
            'Ceiling caption',
            'Ceiling caption',
        ]);

        for (const { role, className } of [...rows, ...captions]) {
            const foregroundClass = className
                .split(/\s+/u)
                .findLast((name) => /^text-(?:muted-foreground|text-secondary)(?:\/\d+)?$/u.test(name));
            if (foregroundClass === undefined) {
                throw new Error(`Missing ${role} foreground class`);
            }
            const token = foregroundClass.startsWith('text-muted-foreground')
                ? '--color-muted-foreground'
                : '--color-text-secondary';
            const alphaSource = /\/(\d+)$/u.exec(foregroundClass)?.[1];
            const baseForeground = readLightColor(token);
            for (const [stop, background] of Object.entries(crustWindowStops())) {
                let foreground = baseForeground;
                if (alphaSource !== undefined) {
                    foreground = composite(baseForeground, background, Number(alphaSource) / 100);
                }
                expect(contrast(foreground, background), `${role} on Crust ${stop}`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it('keeps every Crust gain text state readable on both real gradient stops', () => {
        expect(gainSource).toContain("let valueColor = 'var(--color-text-primary)';");
        expect(gainSource).toContain("valueColor = 'var(--color-state-warning)';");
        expect(gainSource).toContain("valueColor = 'var(--color-state-danger)';");

        const secondary = readToken(lightBlock, '--color-text-secondary');
        for (const label of ['Gain', '0', 'dB']) {
            const labelClass = new RegExp(`<span className="([^"]*)">${label}</span>`, 'u').exec(gainSource)?.[1] ?? '';
            expect(labelClass, `${label} semantic role`).toContain('text-muted-foreground');
            expect(labelClass, `${label} opaque role`).not.toContain('text-muted-foreground/');
        }

        for (const surface of ['--surface-base', '--surface-default']) {
            const background = readToken(lightBlock, surface);
            expect(contrast(secondary, background), `Gain labels on ${surface}`).toBeGreaterThanOrEqual(4.5);
            for (const { stateToken, colorToken } of [
                { stateToken: '--color-text-primary', colorToken: '--color-text-primary' },
                { stateToken: '--color-state-warning', colorToken: '--color-accent-amber' },
                { stateToken: '--color-state-danger', colorToken: '--color-accent-red' },
            ]) {
                expect(
                    contrast(readToken(lightBlock, colorToken), background),
                    `${stateToken} on ${surface}`
                ).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it('keeps all six Level 5 labels readable on both real Crust window stops', () => {
        const level5Source = /const Level5Stats =[\s\S]*?\n\};\n\n\/\/ ── Main/u.exec(controlZoneSource)?.[0] ?? '';
        const labels = Array.from(level5Source.matchAll(/\['([^']+)',/gu), (match) => match[1]);
        expect(labels).toEqual(['Integrated', 'ST Max', 'MOM Max', 'LRA', 'TP Max', 'GR Max']);
        const labelClass = /labelClassName="([^"]*)"/u.exec(level5Source)?.[1] ?? '';
        expect(labelClass).toContain('text-muted-foreground');
        expect(labelClass).not.toContain('text-muted-foreground/');

        const secondary = readToken(lightBlock, '--color-text-secondary');
        for (const [stop, background] of Object.entries(crustWindowStops())) {
            expect(contrast(secondary, background), `Level 5 labels on ${stop}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('keeps every remaining Crust control label and value opaque and readable on real window stops', () => {
        expect(controlZoneSource).not.toMatch(/\btext-(?:muted-foreground|foreground)\/\d+/u);
        expect(controlZoneSource).toContain('valueClassName="text-micro text-foreground"');

        for (const token of ['--color-text-primary', '--color-text-secondary']) {
            const foreground = readLightColor(token);
            for (const [stop, background] of Object.entries(crustWindowStops())) {
                expect(contrast(foreground, background), `${token} on Crust ${stop}`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it('keeps Crust desk, section, and choice-detail text opaque and readable on real window stops', () => {
        expect(crustPanelSource).not.toMatch(/text-\[var\(--color-accent-copper\)\]\/\d+/u);
        expect(crustPanelSource).toContain('titleClassName="text-muted-foreground"');

        const choiceRowSource = readFileSync(
            resolve(process.cwd(), 'src/components/daw/DawPluginChoiceRow.tsx'),
            'utf8'
        );
        const detailClass = /<span className="([^"]*tracking-\[0\.2em\][^"]*)">/u.exec(choiceRowSource)?.[1] ?? '';
        expect(detailClass).toContain('text-muted-foreground');
        expect(detailClass).not.toMatch(/text-muted-foreground\//u);

        for (const token of ['--color-accent-copper', '--color-text-secondary']) {
            const foreground = readLightColor(token);
            for (const [stop, background] of Object.entries(crustWindowStops())) {
                expect(contrast(foreground, background), `${token} on Crust ${stop}`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it.each(['ghost', 'outline'])('keeps active %s text readable at every real Light inset stop', (variant) => {
        const buttonSource = readFileSync(resolve(process.cwd(), 'src/components/ui/button.tsx'), 'utf8');
        const variantClass = new RegExp(`\\b${variant}:\\s*'([^']+)'`, 'u').exec(buttonSource)?.[1] ?? '';
        expect(variantClass).toContain('text-text-secondary');
        expect(variantClass).toContain('active:daw-inset-surface');
        expect(variantClass).toContain('active:text-text-primary');

        const insetBlock = utilityBlock('daw-inset-surface');
        const [topWhite, bottomWhite, topBlack] = Array.from(
            insetBlock.matchAll(/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/gu),
            (match) => parseCssColor(match[0])
        );
        const fadeEndpoint = Number(/transparent\s+([\d.]+)%/u.exec(insetBlock)?.[1]);
        if (
            topWhite === undefined ||
            bottomWhite === undefined ||
            topBlack === undefined ||
            !Number.isFinite(fadeEndpoint)
        ) {
            throw new Error('Missing Light inset gradient stops');
        }
        const panelInset = readToken(lightBlock, '--color-bg-panelInset');
        const fadeWhiteAlpha = topWhite.alpha + (bottomWhite.alpha - topWhite.alpha) * (fadeEndpoint / 100);
        const overPanel = (white: CssColor, blackAlpha: number): string =>
            composite(white.color, composite(topBlack.color, panelInset, blackAlpha), white.alpha);
        const stops = {
            top: overPanel(topWhite, topBlack.alpha),
            fade: overPanel({ color: topWhite.color, alpha: fadeWhiteAlpha }, 0),
            bottom: overPanel(bottomWhite, 0),
        };
        const primary = readToken(lightBlock, '--color-text-primary');
        for (const [stop, background] of Object.entries(stops)) {
            expect(contrast(primary, background), `${variant} active text on inset ${stop}`).toBeGreaterThanOrEqual(
                4.5
            );
        }
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

    const activeChipExpectations = [
        {
            tone: 'neutral',
            foregroundClass: 'text-text-primary',
            backgroundClass: 'bg-surface-raised/60',
            borderClass: 'border-border-active',
        },
        {
            tone: 'amber',
            foregroundClass: 'text-[var(--color-accent-amber)]',
            backgroundClass: 'bg-[var(--color-accent-amber)]/14',
            borderClass: 'border-[var(--color-accent-amber)]/60',
        },
        {
            tone: 'cyan',
            foregroundClass: 'text-[var(--color-accent-cyan)]',
            backgroundClass: 'bg-[var(--color-accent-cyan)]/12',
            borderClass: 'border-[var(--color-accent-cyan)]/60',
        },
        {
            tone: 'peach',
            foregroundClass: 'text-[var(--color-accent-peach)]',
            backgroundClass: 'bg-[var(--color-accent-peach)]/12',
            borderClass: 'border-[var(--color-accent-peach)]/60',
        },
        {
            tone: 'lavender',
            foregroundClass: 'text-[var(--color-accent-lavender)]',
            backgroundClass: 'bg-[var(--color-accent-lavender)]/12',
            borderClass: 'border-[var(--color-accent-lavender)]/60',
        },
        {
            tone: 'mint',
            foregroundClass: 'text-[var(--color-accent-mint)]',
            backgroundClass: 'bg-[var(--color-accent-mint)]/12',
            borderClass: 'border-[var(--color-accent-mint)]/60',
        },
        {
            tone: 'steel',
            foregroundClass: 'text-[var(--color-accent-steel)]',
            backgroundClass: 'bg-[var(--color-accent-steel)]/14',
            borderClass: 'border-[var(--color-accent-steel)]/60',
        },
        {
            tone: 'danger',
            foregroundClass: 'text-[var(--color-state-danger)]',
            backgroundClass: 'bg-[var(--color-state-danger)]/12',
            borderClass: 'border-[var(--color-state-danger)]/60',
        },
        {
            tone: 'rose',
            foregroundClass: 'text-[var(--color-accent-rose)]',
            backgroundClass: 'bg-[var(--color-accent-rose)]/14',
            borderClass: 'border-[var(--color-accent-rose)]/60',
        },
        {
            tone: 'indigo',
            foregroundClass: 'text-[var(--color-accent-indigo)]',
            backgroundClass: 'bg-[var(--color-accent-indigo)]/12',
            borderClass: 'border-[var(--color-accent-indigo)]/60',
        },
        {
            tone: 'sage',
            foregroundClass: 'text-[var(--color-accent-sage)]',
            backgroundClass: 'bg-[var(--color-accent-sage)]/12',
            borderClass: 'border-[var(--color-accent-sage)]/60',
        },
        {
            tone: 'copper',
            foregroundClass: 'text-[var(--color-accent-copper)]',
            backgroundClass: 'bg-[var(--color-accent-copper)]/12',
            borderClass: 'border-[var(--color-accent-copper)]/60',
        },
    ] as const;

    it.each(activeChipExpectations)(
        'observes the emitted $tone active-chip classes and contrast above 4.75:1',
        ({ tone, foregroundClass: expectedForeground, backgroundClass: expectedBackground, borderClass }) => {
            const markup = renderToStaticMarkup(createElement(DawPluginChip, { active: true, tone }, tone));
            const finalClasses =
                parseActiveHtml(markup).querySelector('button')?.getAttribute('class')?.split(/\s+/u).filter(Boolean) ??
                [];
            expect(finalClasses).toEqual(expect.arrayContaining([expectedForeground, expectedBackground, borderClass]));

            const foregroundClasses = finalClasses.filter((name) => /(?:^|:)text-/u.test(name));
            expect(foregroundClasses).toEqual([expectedForeground]);
            const foregroundClass = foregroundClasses[0];
            const foregroundToken =
                /^text-\[var\((--[a-z-]+)\)\]$/u.exec(foregroundClass ?? '')?.[1] ??
                (foregroundClass === 'text-text-primary' ? '--color-text-primary' : undefined);
            const backgroundMatch = finalClasses
                .map((name) => /^bg-(?:\[var\((--[a-z-]+)\)\]|(surface-raised))\/(\d+)$/u.exec(name))
                .find((match) => match !== null);
            const backgroundToken =
                backgroundMatch?.[1] ?? (backgroundMatch?.[2] === 'surface-raised' ? '--surface-raised' : undefined);
            const alphaSource = backgroundMatch?.[3];
            if (foregroundToken === undefined || backgroundToken === undefined || alphaSource === undefined) {
                throw new Error(`Missing rendered active-chip foreground or background for ${tone}`);
            }
            const foreground = readLightColor(foregroundToken);
            const backgroundAccent = readLightColor(backgroundToken);
            for (const surfaceToken of [
                '--surface-deep',
                '--surface-base',
                '--surface-default',
                '--surface-raised',
                '--color-bg-well',
                '--color-bg-panelInset',
            ]) {
                const background = composite(
                    backgroundAccent,
                    readToken(lightBlock, surfaceToken),
                    Number(alphaSource) / 100
                );
                expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.75);
            }
        }
    );

    it('keeps both Crust Style tile text rows readable on their nested black wells', () => {
        const levelTileSource = /const LevelTile =[\s\S]*?\n\);\n\nconst Level1/u.exec(controlZoneSource)?.[0] ?? '';
        const inactiveClass = /:\s*'([^']*bg-black\/20[^']*)'/u.exec(levelTileSource)?.[1] ?? '';
        const subtitleClass = /<span className="([^"]*whitespace-pre-line[^"]*)">/u.exec(levelTileSource)?.[1] ?? '';
        const wellAlphaSource = /bg-black\/(\d+)/u.exec(inactiveClass)?.[1];
        expect(inactiveClass).toContain('text-foreground');
        expect(inactiveClass).not.toContain('text-white');
        expect(subtitleClass).toContain('text-foreground');
        expect(subtitleClass).not.toMatch(/text-(?:muted-foreground|white)\//u);
        expect(wellAlphaSource).toBeDefined();

        const primary = readToken(lightBlock, '--color-text-primary');
        for (const [stop, windowBackground] of Object.entries(crustWindowStops())) {
            const background = composite('#000000', windowBackground, Number(wellAlphaSource) / 100);
            expect(contrast(primary, background), `Style tile text on ${stop} black well`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it.each([
        {
            route: 'ProofChamber',
            source: proofChamberSource,
            utility: 'proof-chamber-window',
            accents: ['--color-accent-amber', '--color-accent-cyan', '--color-accent-peach', '--color-accent-lavender'],
            preservedDisplay: "ctx.fillStyle = 'rgb(3,3,5)';",
        },
        {
            route: 'Tuner',
            source: tunerSource,
            utility: 'scoring-window',
            accents: ['--color-accent-indigo', '--color-accent-mint', '--color-state-warning', '--color-state-danger'],
            preservedDisplay: "ctx.fillStyle = 'white';",
        },
    ])(
        'keeps $route semantic text readable on its real Light windows and nested wells',
        ({ source, utility, accents, preservedDisplay }) => {
            expect(source).not.toMatch(/\btext-white\//u);
            expect(source).not.toMatch(/text-\[var\(--color-accent-[^\]]+\)\]\/\d+/u);
            expect(source).not.toMatch(/\btext-(?:emerald|yellow|red)-400\b/u);
            expect(source).toContain('text-text-primary');
            expect(source).toContain('text-text-secondary');
            expect(source).toContain(preservedDisplay);

            const foregrounds = {
                primary: readToken(lightBlock, '--color-text-primary'),
                secondary: readToken(lightBlock, '--color-text-secondary'),
            };
            for (const accent of accents) {
                expect(source).toContain(`var(${accent})`);
            }
            const stops = mainWindowStops(utility);
            for (const [stop, background] of Object.entries(stops)) {
                for (const [role, foreground] of Object.entries(foregrounds)) {
                    expect(contrast(foreground, background), `${role} on ${utility} ${stop}`).toBeGreaterThanOrEqual(
                        4.5
                    );
                }
                for (const accent of accents) {
                    expect(
                        contrast(readLightColor(accent), background),
                        `${accent} on ${utility} ${stop}`
                    ).toBeGreaterThanOrEqual(4.5);
                }
            }

            const panelInset = readToken(lightBlock, '--color-bg-panelInset');
            for (const [role, foreground] of Object.entries(foregrounds)) {
                expect(contrast(foreground, panelInset), `${role} on nested panelInset`).toBeGreaterThanOrEqual(4.5);
            }
            const blackWellAlphas = Array.from(source.matchAll(/bg-black\/(\d+)/gu), (match) => Number(match[1]));
            for (const alpha of blackWellAlphas) {
                for (const [stop, windowBackground] of Object.entries(stops)) {
                    const background = composite('#000000', windowBackground, alpha / 100);
                    expect(
                        contrast(foregrounds.primary, background),
                        `primary on ${utility} ${stop} black/${alpha} well`
                    ).toBeGreaterThanOrEqual(4.5);
                }
            }
        }
    );

    it('keeps every Tuner main-read state readable over its actual inline center glow', () => {
        const toneBlock = /let toneColor: string;([\s\S]*?)\n\s*let centerGlow/u.exec(tunerSource)?.[1] ?? '';
        const glowBlock = /let centerGlow: string;([\s\S]*?)\n\s*let displayComponent/u.exec(tunerSource)?.[1] ?? '';
        const toneClasses = Array.from(toneBlock.matchAll(/toneColor = '([^']+)'/gu), (match) => match[1]);
        const glowSources = Array.from(glowBlock.matchAll(/centerGlow = '([^']+)'/gu), (match) => match[1]);
        const stateNames = ['inactive', 'active in-tune', 'active warning', 'active danger'];
        expect(toneClasses).toEqual([
            'text-text-secondary',
            'text-[var(--color-accent-mint)]',
            'text-[var(--color-state-warning)]',
            'text-[var(--color-state-danger)]',
        ]);
        expect(glowSources).toHaveLength(stateNames.length);
        expect(tunerSource).toContain(
            'background: `radial-gradient(circle at 50% 50%, ${centerGlow}, transparent 56%)`'
        );

        const secondary = readLightColor('--color-text-secondary');
        for (const [index, toneClass] of toneClasses.entries()) {
            const glowSource = glowSources[index];
            const stateName = stateNames[index];
            if (toneClass === undefined || glowSource === undefined || stateName === undefined) {
                throw new Error('Missing Tuner main-read state');
            }
            const token = /^text-\[var\((--[a-z-]+)\)\]$/u.exec(toneClass)?.[1];
            if (toneClass !== 'text-text-secondary' && token === undefined) {
                throw new Error(`Missing ${stateName} foreground token`);
            }
            const stateForeground = readLightColor(token ?? '--color-text-secondary');
            const glow = parseCssColor(glowSource);
            for (const [stop, surface] of Object.entries(mainWindowStops('scoring-window'))) {
                const background = composite(glow.color, surface, glow.alpha);
                for (const [role, foreground] of Object.entries({ state: stateForeground, secondary })) {
                    expect(
                        contrast(foreground, background),
                        `Tuner ${stateName} ${role} over centerGlow on ${stop}`
                    ).toBeGreaterThanOrEqual(4.5);
                }
            }
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
        for (const source of [grinderSource, importedSource]) {
            expect(source).not.toMatch(/\btext-white\//u);
            expect(source).toContain('text-text-primary');
        }
        expect(grinderSource).toContain('text-text-secondary');
        expect(grinderSource).not.toMatch(/bg-black\/20 px-3 py-2\.5">\s*<div className="[^"]*text-text-secondary/u);
        expect(grinderSource).toContain('rounded-[20px] border border-white/8 bg-black/30 p-4');
        expect(grinderSource).toContain("className={`grinder-tab ${active ? 'grinder-tab-active' : ''}`}");

        const windowBlock = utilityBlock('grinder-window');
        expect(windowBlock).toContain('linear-gradient(180deg, rgba(241, 165, 75, 0.06), transparent 22%)');
        const tabBlock = utilityBlock('grinder-tab');
        expect(tabBlock).toMatch(/color:\s*var\(--color-text-primary\);/u);
        const tabBackground = /background:\s*rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/u.exec(tabBlock);
        expect(tabBackground?.slice(1, 4)).toEqual(['0', '0', '0']);
        const tabAlpha = Number(tabBackground?.[4]);
        expect(tabAlpha).toBe(0.22);

        const primary = readToken(lightBlock, '--color-text-primary');
        const secondary = readToken(lightBlock, '--color-text-secondary');
        const panelInset = readToken(lightBlock, '--color-bg-panelInset');
        const stops = grinderWindowStops();
        const activeTabBlock = utilityBlock('grinder-tab-active');
        const activeForegroundSource = /color:\s*([^;]+);/u.exec(activeTabBlock)?.[1];
        if (activeForegroundSource === undefined) {
            throw new Error('Missing active Grinder tab foreground');
        }
        const activeForeground = parseCssColor(activeForegroundSource).color;
        const activeBackground = /background:\s*linear-gradient\(([^;]+)\);/u.exec(activeTabBlock)?.[1] ?? '';
        const activeGradient = Array.from(
            activeBackground.matchAll(/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/gu),
            (match) => parseCssColor(match[0])
        );
        expect(activeGradient).toHaveLength(2);
        for (const [surfaceName, surface] of Object.entries({ ...grinderFaceplateStops(), ...stops })) {
            for (const [gradientIndex, layer] of activeGradient.entries()) {
                const background = composite(layer.color, surface, layer.alpha);
                expect(
                    contrast(activeForeground, background),
                    `active Grinder tab gradient ${gradientIndex} on ${surfaceName}`
                ).toBeGreaterThanOrEqual(4.5);
            }
        }
        for (const [surfaceName, background] of Object.entries({ panelInset, ...stops })) {
            for (const [role, foreground] of Object.entries({ primary, secondary })) {
                expect(contrast(foreground, background), `${role} on ${surfaceName}`).toBeGreaterThanOrEqual(4.5);
            }
            const inactiveTabBackground = composite('#000000', background, tabAlpha);
            expect(
                contrast(primary, inactiveTabBackground),
                `inactive Grinder tab on ${surfaceName}`
            ).toBeGreaterThanOrEqual(4.5);
        }
        for (const alpha of [16, 18, 20, 24, 25, 30]) {
            const background = composite('#000000', stops.windowTop, alpha / 100);
            expect(contrast(primary, background), `primary on black/${alpha} well`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('keeps Grinder chips and toggles readable on their real window and black-well backdrops', () => {
        const grinderSource = readFileSync(
            resolve(process.cwd(), 'src/modules/Grinder/presentations/views/GrinderPanel.tsx'),
            'utf8'
        );
        const toggleSource = readFileSync(resolve(process.cwd(), 'src/components/daw/DawPluginToggle.tsx'), 'utf8');
        expect(toggleSource).toMatch(/<DawPluginChip active=\{pressed\}[^>]*tone=\{tone\}/u);

        const windowBlock = utilityBlock('grinder-window');
        expect(windowBlock).toContain('var(--color-bg-panelInset)');
        const windowTop = grinderWindowStops().windowTop;
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

    it('measures the actual Grinder category chip foreground and tinted background', () => {
        const grinderSource = readFileSync(
            resolve(process.cwd(), 'src/modules/Grinder/presentations/views/GrinderPanel.tsx'),
            'utf8'
        );
        const categoryChip =
            /\{categories\.map\(\(item\) => \(\s*(<DawPluginChip\b[\s\S]*?<\/DawPluginChip>)\s*\)\)\}/u.exec(
                grinderSource
            )?.[1];
        expect(categoryChip).toContain('active={category === item}');
        expect(categoryChip).toContain('tone="amber"');
        expect(categoryChip).not.toContain('className=');
        const markup = renderToStaticMarkup(
            createElement(DawPluginChip, { active: true, tone: 'amber', size: 'sm' }, 'All')
        );
        const finalClasses =
            parseActiveHtml(markup).querySelector('button')?.getAttribute('class')?.split(/\s+/u).filter(Boolean) ?? [];
        const foregroundClass = finalClasses.findLast(
            (name) => /^text-\[var\(--[a-z-]+\)\]$/u.test(name) || name === 'text-surface-raised'
        );
        const foregroundToken =
            /^text-\[var\((--[a-z-]+)\)\]$/u.exec(foregroundClass ?? '')?.[1] ??
            (foregroundClass === 'text-surface-raised' ? '--surface-raised' : undefined);
        const backgroundMatch = finalClasses
            .map((name) => /^bg-\[var\((--[a-z-]+)\)\]\/(\d+)$/u.exec(name))
            .find((match) => match !== null);
        if (foregroundToken === undefined || backgroundMatch === undefined) {
            throw new Error('Missing final Grinder category chip foreground or tinted background');
        }
        const windowBackground = grinderWindowStops().windowTop;
        const background = composite(
            readLightColor(backgroundMatch[1] ?? ''),
            windowBackground,
            Number(backgroundMatch[2]) / 100
        );
        expect(contrast(readLightColor(foregroundToken), background)).toBeGreaterThanOrEqual(4.75);
    });

    it('keeps Grinder Diagnostics orange readable on every real Light window stop', () => {
        const grinderSource = readFileSync(
            resolve(process.cwd(), 'src/modules/Grinder/presentations/views/GrinderPanel.tsx'),
            'utf8'
        );
        expect(grinderSource).toMatch(/text-\[var\(--color-accent-orange\)\][^"]*">\s*Diagnostics/u);
        const orange = readToken(lightBlock, '--color-accent-orange');
        for (const [stop, background] of Object.entries(grinderWindowStops())) {
            expect(contrast(orange, background), `Diagnostics on ${stop}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('keeps imported Remove and Patch labels readable on their nested semantic Light wells', () => {
        const importedSource = readFileSync(
            resolve(process.cwd(), 'src/modules/Grinder/presentations/components/ImportedNeuralLibraryCard.tsx'),
            'utf8'
        );
        const unselectedCard = /selected\s*\?\s*'[^']+'\s*:\s*'([^']+)'/u.exec(importedSource)?.[1] ?? '';
        expect(unselectedCard).toContain('bg-bg-well');
        const removeClass =
            /className="([^"]+)"\s+onClick=\{\(\) => on_remove\(entry\)\}/u.exec(importedSource)?.[1] ?? '';
        const patchClass = /<span className="([^"]+)">\s*Patch only/u.exec(importedSource)?.[1] ?? '';
        const primary = readToken(lightBlock, '--color-text-primary');
        const cardWell = readToken(lightBlock, '--color-bg-well');
        const surface = readToken(lightBlock, '--surface-default');
        for (const [route, className] of Object.entries({ Remove: removeClass, Patch: patchClass })) {
            expect(className, `${route} text`).toContain('text-text-primary');
            const alphaSource = /bg-surface-default\/(\d+)/u.exec(className)?.[1];
            expect(alphaSource, `${route} semantic nested surface`).toBeDefined();
            const nestedWell = composite(surface, cardWell, Number(alphaSource) / 100);
            expect(contrast(primary, nestedWell), `${route} nested composite`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('keeps the Neural import error readable on its resolved Light danger surface', () => {
        const grinderSource = readFileSync(
            resolve(process.cwd(), 'src/modules/Grinder/presentations/views/GrinderPanel.tsx'),
            'utf8'
        );
        const errorClass = /<div className="([^"]+)">\s*\{neural_library_state.error\}/u.exec(grinderSource)?.[1] ?? '';
        expect(errorClass).toContain('text-state-danger');
        expect(errorClass).toContain('border-state-danger/30');
        const alphaSource = /bg-state-danger\/(\d+)/u.exec(errorClass)?.[1];
        expect(alphaSource).toBeDefined();
        const danger = readToken(lightBlock, '--color-accent-red');
        for (const [stop, windowBackground] of Object.entries(grinderWindowStops())) {
            const background = composite(danger, windowBackground, Number(alphaSource) / 100);
            expect(contrast(danger, background), `Neural import error on ${stop}`).toBeGreaterThanOrEqual(4.5);
        }
    });
});

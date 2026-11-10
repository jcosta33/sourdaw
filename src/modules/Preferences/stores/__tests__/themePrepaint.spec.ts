import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { parse, stringify } from 'superjson';
import { describe, expect, it } from 'vitest';

import { validateStoredPreferences } from '../preferencesStore';

const startupThemeScript = readFileSync(resolve(process.cwd(), 'public/themePrepaint.js'), 'utf8');
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

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

describe('theme prepaint', () => {
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
            name: 'Dark raw JSON resolved to Light by a v1 nested equality',
            stored: JSON.stringify({
                json: { theme: 'dark', other: 'light' },
                meta: { referentialEqualities: { other: ['theme'] }, v: 1 },
            }),
        },
        {
            name: 'v0 nested equality with an escaped dot',
            stored: JSON.stringify({
                json: { theme: 'dark', 'other.value': 'light' },
                meta: { referentialEqualities: { 'other\\.value': ['theme'] }, v: 0 },
            }),
        },
        {
            name: 'versionless nested equality with an escaped dot',
            stored: JSON.stringify({
                json: { theme: 'dark', 'other.value': 'light' },
                meta: { referentialEqualities: { 'other\\.value': ['theme'] } },
            }),
        },
        {
            name: 'v0 root equality with an escaped dot',
            stored: JSON.stringify({
                json: { theme: 'light', 'other.value': null },
                meta: { referentialEqualities: [['other\\.value']], v: 0 },
            }),
        },
        {
            name: 'versionless root equality with an escaped dot',
            stored: JSON.stringify({
                json: { theme: 'light', 'other.value': null },
                meta: { referentialEqualities: [['other\\.value']] },
            }),
        },
        {
            name: 'v0 nested equality with a literal backslash',
            stored: JSON.stringify({
                json: { theme: 'dark', 'other\\value': 'light' },
                meta: { referentialEqualities: { 'other\\value': ['theme'] }, v: 0 },
            }),
        },
        {
            name: 'versionless nested equality with a literal backslash',
            stored: JSON.stringify({
                json: { theme: 'dark', 'other\\value': 'light' },
                meta: { referentialEqualities: { 'other\\value': ['theme'] } },
            }),
        },
        {
            name: 'v0 root equality with a literal backslash',
            stored: JSON.stringify({
                json: { theme: 'light', 'other\\value': null },
                meta: { referentialEqualities: [['other\\value']], v: 0 },
            }),
        },
        {
            name: 'versionless root equality with a literal backslash',
            stored: JSON.stringify({
                json: { theme: 'light', 'other\\value': null },
                meta: { referentialEqualities: [['other\\value']] },
            }),
        },
        {
            name: 'dangerous v0 equality path',
            stored: JSON.stringify({
                json: { theme: 'dark', constructor: 'light' },
                meta: { referentialEqualities: { constructor: ['theme'] }, v: 0 },
            }),
        },
        {
            name: 'dangerous v1 equality path',
            stored: JSON.stringify({
                json: { theme: 'dark', constructor: 'light' },
                meta: { referentialEqualities: { constructor: ['theme'] }, v: 1 },
            }),
        },
        {
            name: 'dangerous v0 value path',
            stored: '{"json":{"theme":"light","constructor":"dark"},"meta":{"values":{"constructor":["undefined"]},"v":0}}',
        },
        {
            name: 'dangerous v1 value path',
            stored: '{"json":{"theme":"light","constructor":"dark"},"meta":{"values":{"constructor":["undefined"]},"v":1}}',
        },
        {
            name: 'direct theme value annotation',
            stored: '{"json":{"theme":"light"},"meta":{"values":{"theme":["number"]}}}',
        },
        {
            name: 'root value annotation',
            stored: '{"json":{"theme":"light"},"meta":{"values":["number"],"v":1}}',
        },
        {
            name: 'empty value annotation tuple with annotated and unannotated siblings',
            stored: '{"json":{"theme":"light","annotated":"remove","unannotated":"keep"},"meta":{"values":{"annotated":[]},"v":1}}',
        },
        {
            name: 'empty value annotation tuple on the theme',
            stored: '{"json":{"theme":"light"},"meta":{"values":{"theme":[]},"v":1}}',
        },
        {
            name: 'inert null and empty dangerous value subtrees in v0',
            stored: '{"json":{"theme":"light"},"meta":{"values":{"constructor":null,"prototype":{},"__proto__":null},"v":0}}',
        },
        {
            name: 'inert null and empty dangerous value subtrees in v1',
            stored: '{"json":{"theme":"light","other":{}},"meta":{"values":{"other.constructor":null,"other.prototype":{},"other.__proto__":null},"v":1}}',
        },
        {
            name: 'numeric non-string root equality path',
            stored: '{"json":{"theme":"light","other":null},"meta":{"referentialEqualities":[[0]],"v":1}}',
        },
        {
            name: 'boolean non-string root equality path',
            stored: '{"json":{"theme":"light","other":null},"meta":{"referentialEqualities":[[false]],"v":0}}',
        },
        {
            name: 'numeric non-string nested equality target',
            stored: '{"json":{"theme":"light","other":"dark","copy":null},"meta":{"referentialEqualities":{"other":[0]},"v":1}}',
        },
        {
            name: 'boolean non-string nested equality target',
            stored: '{"json":{"theme":"light","other":"dark","copy":null},"meta":{"referentialEqualities":{"other":[false]},"v":0}}',
        },
        {
            name: 'array non-string nested equality target',
            stored: '{"json":{"theme":"light","other":"dark","copy":null},"meta":{"referentialEqualities":{"other":[["copy"]]},"v":1}}',
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
            name: 'mixed root and nested aliases',
            stored: '{"json":{"theme":"light","other":null,"first":{"value":1},"second":{"value":1}},"meta":{"referentialEqualities":[["other"],{"first":["second"]}],"v":1}}',
        },
        {
            name: 'root theme and sibling aliases',
            stored: '{"json":{"theme":"light","other":null},"meta":{"referentialEqualities":[["theme","other"]],"v":1}}',
        },
        {
            name: 'empty nested equality targets',
            stored: '{"json":{"theme":"light","other":{}},"meta":{"referentialEqualities":{"other":[]},"v":1}}',
        },
        {
            name: 'unrelated field value metadata',
            stored: stringify({ theme: 'light', elasticTransientSensitivity: Number.NaN }),
        },
        {
            name: 'unrelated valid Date annotation',
            stored: stringify({ theme: 'light', other: new Date('2026-01-02T03:04:05.000Z') }),
        },
        {
            name: 'transformed alias source',
            stored: '{"json":{"theme":"dark","other":"light"},"meta":{"values":{"other":["number"]},"referentialEqualities":{"other":["theme"]},"v":1}}',
        },
        {
            name: 'unknown unrelated value annotation',
            stored: '{"json":{"theme":"light","other":"value"},"meta":{"values":{"other":["unknown-transformation"]},"v":1}}',
        },
        {
            name: 'malformed unrelated value annotation',
            stored: '{"json":{"theme":"light","other":1},"meta":{"values":{"other":["set"]},"v":1}}',
        },
        {
            name: 'null referential metadata',
            stored: '{"json":{"theme":"light"},"meta":{"referentialEqualities":null,"v":1}}',
        },
        {
            name: 'null nested referential metadata',
            stored: '{"json":{"theme":"light"},"meta":{"referentialEqualities":[[],null],"v":1}}',
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
            // createLocalStorage returns the raw string when SuperJSON rejects it.
            decoded = stored;
        }
        const validatedTheme = validateStoredPreferences(decoded).theme;

        expect(runStartupTheme(stored)).toEqual({
            classes: new Set([validatedTheme]),
            colorScheme: validatedTheme,
            themeColor: validatedTheme === 'light' ? '#ded8cf' : '#020100',
        });
    });
});

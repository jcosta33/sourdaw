import { createRequire } from 'node:module';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';
import { createElement, useState } from 'react';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const domRequire = createRequire(require.resolve('@testing-library/dom/package.json'));
const jestDomRequire = createRequire(require.resolve('@testing-library/jest-dom/package.json'));
const viteRequire = createRequire(require.resolve('vite/package.json'));
const postcss: { parse(css: string): { source?: { input: { from: string } } } } = viteRequire('postcss');
const pretty: {
    format(value: unknown, options: { plugins: unknown[] }): string;
    plugins: { ReactElement: unknown };
} = domRequire('pretty-format');

describe('DOM dependency consumer behavior', () => {
    it('keeps accessible roles, names, hidden-state exclusion and diagnostics', () => {
        render(
            <section aria-label="Track controls">
                <button aria-label="Mute bass" aria-pressed="true" />
                <button aria-label="Mute lead" aria-hidden="true" />
                <button aria-label="Solo drums" />
            </section>
        );
        expect(screen.getByRole('button', { name: 'Mute bass', pressed: true })).toHaveAccessibleName('Mute bass');
        expect(screen.queryByRole('button', { name: 'Mute lead' })).toBeNull();
        let diagnostic = '';
        try {
            screen.getByRole('button', { name: 'Missing instrument' });
        } catch (error) {
            diagnostic = String(error);
        }
        expect(diagnostic).toContain('Mute bass');
        expect(diagnostic).toContain('Solo drums');
        expect(diagnostic.split('Ignored nodes:')[0]).not.toContain('Mute lead');
        expect(() => screen.getByRole('button', { name: 'Mute bass', pressed: false })).toThrow();
    });

    it('renders a named dialog with keyboard-focusable controls', () => {
        render(
            <div role="dialog" aria-label="Onboarding tour">
                <button>Skip tour</button>
                <button disabled>Back</button>
                <button>Next</button>
            </div>
        );
        expect(screen.getByRole('dialog', { name: 'Onboarding tour' })).toBeInTheDocument();
        const next = screen.getByRole('button', { name: 'Next' });
        next.focus();
        expect(next).toHaveFocus();
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    });

    it('preserves focus, keyboard events and observable async changes', async () => {
        const seen: string[] = [];
        function Control() {
            const [state, setState] = useState('ready');
            return (
                <button
                    onFocus={() => seen.push('focus')}
                    onKeyDown={(event) => {
                        seen.push(event.key);
                        if (event.key === 'Enter') setState('activated');
                    }}
                >
                    {state}
                </button>
            );
        }
        render(<Control />);
        const button = screen.getByRole('button', { name: 'ready' });
        button.focus();
        expect(button).toHaveFocus();
        fireEvent.keyDown(button, { key: 'Enter' });
        await waitFor(() => expect(button).toHaveTextContent('activated'));
        expect(seen).toEqual(['focus', 'Enter']);
    });

    it('checks style values and rejects a mismatched value with a useful error', () => {
        render(
            <div role="status" style={{ color: 'red', marginLeft: '4px' }}>
                Saved
            </div>
        );
        const status = screen.getByRole('status');
        expect(status).toHaveStyle('color: rgb(255, 0, 0); margin-left: 4px');
        expect(() => expect(status).toHaveStyle('margin-left: 9px')).toThrow(/margin-left/);
        expect(() => expect(status).toHaveStyle('color red')).toThrow(/Syntax error parsing expected css/);
    });

    it('parses stylesheet sources and decodes a labelled non-UTF8 HTML response', () => {
        expect(postcss.parse('.value { color: red }').source?.input.from).toMatch(/^<input css /);
        const html = Buffer.from('<p>caf\xe9</p>', 'latin1');
        const parsed = new JSDOM(html, { contentType: 'text/html; charset=windows-1252' });
        expect(parsed.window.document.querySelector('p')?.textContent).toBe('café');
        parsed.window.close();
    });

    it('runs the actual CommonJS matcher failure-message path', () => {
        expect.extend(jestDomRequire('@testing-library/jest-dom/matchers'));
        render(
            <div role="status" style={{ marginLeft: '4px' }}>
                Saved
            </div>
        );
        expect(() => expect(screen.getByRole('status')).toHaveStyle('margin-left: 9px')).toThrow(/margin-left/);
        expect(() => expect(screen.getByRole('status')).toHaveTextContent('Missing')).toThrow(
            /Expected element to have text content/
        );
    });

    it('runs CJS and ESM PostCSS against missing source and error locations', async () => {
        const cjs = viteRequire('postcss');
        const postcssEsm = await import(
            pathToFileURL(join(viteRequire.resolve('postcss/package.json'), '../lib/postcss.mjs')).href
        );
        for (const parser of [cjs, postcssEsm.default]) {
            expect(parser.parse('a { color: red }').source.input.from).toMatch(/^<input css /);
            expect(() => parser.parse('a { color: red')).toThrow(/Unclosed block/);
            try {
                parser.parse('a { color: red');
            } catch (error) {
                expect(error).toMatchObject({ line: 1, column: 1 });
            }
        }
    });

    it('rejects malformed CSS using the real parser under bounded input', () => {
        const css = jestDomRequire('@adobe/css-tools');
        expect(css.parse('* { color: red; margin: 2px }').stylesheet.rules[0].declarations).toHaveLength(2);
        for (const input of ['* {color red}', '* {color: red;', '* { color: red; x'.repeat(50)]) {
            expect(() => css.parse(input)).toThrow();
        }
    });

    it('formats current and legacy React element tags while rejecting unrelated symbols', () => {
        const options = { plugins: [pretty.plugins.ReactElement] };
        const current = createElement('button', null, 'current');
        const legacy = { $$typeof: Symbol.for('react.element'), type: 'button', props: { children: 'legacy' } };
        const unrelated = { $$typeof: Symbol.for('other.element'), type: 'button', props: { children: 'other' } };
        expect(pretty.format(current, options)).toContain('<button>');
        expect(pretty.format(current, options)).toContain('current');
        expect(pretty.format(legacy, options)).toContain('<button>');
        expect(pretty.format(legacy, options)).toContain('legacy');
        expect(pretty.format(unrelated, options)).not.toContain('<button>');
    });

    it('formats legacy fragment, suspense, provider, consumer, memo and forward-ref tags', () => {
        const make = (type: unknown) => ({
            $$typeof: Symbol.for('react.element'),
            type,
            props: { children: 'child' },
        });
        const cases: Array<[unknown, string]> = [
            [Symbol.for('react.fragment'), 'React.Fragment'],
            [Symbol.for('react.suspense'), 'React.Suspense'],
            [{ $$typeof: Symbol.for('react.provider'), _context: {} }, 'Context.Provider'],
            [{ $$typeof: Symbol.for('react.context') }, 'Context.Consumer'],
            [{ $$typeof: Symbol.for('react.memo'), type: () => null }, 'Memo'],
            [{ $$typeof: Symbol.for('react.forward_ref'), render: () => null }, 'ForwardRef'],
        ];
        for (const [type, expected] of cases) {
            expect(pretty.format(make(type), { plugins: [pretty.plugins.ReactElement] })).toContain(expected);
        }
    });
});

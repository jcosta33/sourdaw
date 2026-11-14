// @vitest-environment node

import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { transformSync } from 'esbuild';
import { Linter } from 'eslint';
import { JSDOM } from 'jsdom';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const pluginRoot = dirname(require.resolve('@tanstack/router-plugin/package.json'));
const pluginRequire = createRequire(join(pluginRoot, 'package.json'));
const utilsRoot = dirname(pluginRequire.resolve('@tanstack/router-utils/package.json'));
const compilerRequire = createRequire(require.resolve('@rolldown/plugin-babel'));
const babel = compilerRequire('@babel/core');
const compiler = require('babel-plugin-react-compiler');
const roots: string[] = [];
let activeDom: JSDOM | undefined;

function installDocument() {
    activeDom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    vi.stubGlobal('window', activeDom.window);
    vi.stubGlobal('document', activeDom.window.document);
    vi.stubGlobal('navigator', activeDom.window.navigator);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
}

afterEach(() => {
    cleanup();
    activeDom?.window.close();
    activeDom = undefined;
    vi.unstubAllGlobals();
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

async function routeModules(format: 'esm' | 'cjs') {
    const extension = format === 'esm' ? 'js' : 'cjs';
    return {
        utils: await import(pathToFileURL(join(utilsRoot, `dist/${format}/index.${extension}`)).href),
        compilers: await import(
            pathToFileURL(join(pluginRoot, `dist/${format}/core/code-splitter/compilers.${extension}`)).href
        ),
    };
}

const routeCode = `import { createFileRoute } from '@tanstack/react-router';
import './side-effect.js';
import type { RouteType } from './server-only.js';
const wrap = (value: unknown) => value;
export const Route = createFileRoute('/example')({
  component: wrap(() => import('./view.js')),
  loader: () => import('./data.js'),
});`;

function compileComponent(code: string) {
    const events: { kind: string; fnName?: string }[] = [];
    const result = babel.transformSync(code, {
        filename: 'Widget.tsx',
        configFile: false,
        babelrc: false,
        parserOpts: { sourceType: 'module', plugins: ['typescript', 'jsx'] },
        plugins: [
            [
                compiler.default,
                { logger: { logEvent: (_filename: string, event: { kind: string }) => events.push(event) } },
            ],
        ],
    });
    expect(result?.code).toBeTruthy();
    return { code: String(result.code), events };
}

describe('real Babel consumers', () => {
    it('compiles through the actual Rolldown plugin transform hook', async () => {
        const events: { kind: string }[] = [];
        const entry = await import(pathToFileURL(require.resolve('@rolldown/plugin-babel')).href);
        const plugin = await entry.default({
            parallel: false,
            plugins: [
                [
                    compiler.default,
                    { logger: { logEvent: (_filename: string, event: { kind: string }) => events.push(event) } },
                ],
            ],
        });
        plugin.outputOptions.call({ meta: {} });
        const result = await plugin.transform.handler.call(
            {
                error: (error: { message: string }) => {
                    throw new Error(error.message);
                },
            },
            'export function Widget({value}: {value: string}) { return <div>{value}</div> }',
            'Widget.tsx',
            { moduleType: 'tsx' }
        );
        expect(events).toContainEqual(expect.objectContaining({ kind: 'CompileSuccess' }));
        expect(result.code).toContain('react/compiler-runtime');
        expect(result.code).toContain('<div>{value}</div>');
    });

    it.each(['esm', 'cjs'] as const)(
        'retains split imports, side effects, type erasure, HMR and maps in %s',
        async (format) => {
            const { utils, compilers } = await routeModules(format);
            const result = compilers.compileCodeSplitVirtualRoute({
                code: routeCode,
                filename: '/src/routes/example.tsx',
                splitTargets: ['component', 'loader'],
            });
            expect(result.code).toMatch(/import\(['"]\.\/view\.js['"]\)/u);
            expect(result.code).toMatch(/import\(['"]\.\/data\.js['"]\)/u);
            expect(result.code).toContain('side-effect.js');
            expect(result.code).toContain('wrap');
            expect(result.code).not.toContain('server-only.js');
            expect(result.map.sourcesContent).toEqual([routeCode]);
            const fixture = mkdtempSync(join(tmpdir(), 'babel-split-'));
            roots.push(fixture);
            writeFileSync(join(fixture, 'package.json'), '{"type":"module"}');
            writeFileSync(join(fixture, 'side-effect.js'), 'globalThis.__sourdawBabelRouteProbe += 1;');
            writeFileSync(join(fixture, 'view.js'), 'export default "view";');
            writeFileSync(join(fixture, 'data.js'), 'export default "data";');
            writeFileSync(
                join(fixture, 'split.mjs'),
                transformSync(result.code, { loader: 'tsx', format: 'esm' }).code
            );
            vi.stubGlobal('__sourdawBabelRouteProbe', 0);
            const split = await import(pathToFileURL(join(fixture, 'split.mjs')).href);
            expect(Reflect.get(globalThis, '__sourdawBabelRouteProbe')).toBe(1);
            expect((await split.component()).default).toBe('view');
            expect((await split.loader()).default).toBe('data');
            const reference = compilers.compileCodeSplitReferenceRoute({
                code: routeCode,
                filename: '/src/routes/example.tsx',
                codeSplitGroupings: [['component'], ['loader']],
                targetFramework: 'react',
                addHmr: true,
            });
            expect(reference.code).toContain('import.meta.hot');
            expect(reference.code).toContain('lazyRouteComponent');
            expect(reference.code).toContain('lazyFn');
            expect(reference.code).toContain('side-effect.js');
            expect(reference.map.sourcesContent).toEqual([routeCode]);
            const warnings = vi.spyOn(console, 'warn');
            const ast = utils.parseAst({
                code: `import data from './data.json' with { type: 'json' }; export const view = <div>{data.label}</div>;`,
                filename: '/src/routes/example.tsx',
            });
            const printed = utils.generateFromAst(ast).code;
            expect(printed).toMatch(/with\s*\{\s*type: ['"]json['"]/u);
            expect(printed).toContain('<div>{data.label}</div>');
            expect(
                warnings.mock.calls.flat().filter((value) => String(value).includes('deprecatedImportAssert'))
            ).toEqual([]);
            warnings.mockRestore();
        }
    );

    it.each(['esm', 'cjs'] as const)('generates a real route tree and repairs route IDs through %s', async (format) => {
        const generatorRoot = dirname(pluginRequire.resolve('@tanstack/router-generator/package.json'));
        const generator = await import(
            pathToFileURL(join(generatorRoot, `dist/${format}/index.${format === 'esm' ? 'js' : 'cjs'}`)).href
        );
        const root = mkdtempSync(join(tmpdir(), 'babel-router-'));
        roots.push(root);
        const routes = join(root, 'routes');
        mkdirSync(routes);
        writeFileSync(
            join(routes, '__root.tsx'),
            `import {createRootRoute} from '@tanstack/react-router'; export const Route = createRootRoute();`
        );
        writeFileSync(
            join(routes, 'alpha.tsx'),
            `import {createFileRoute} from '@tanstack/react-router'; export const Route = createFileRoute('/wrong')({component: () => <div>Alpha</div>});`
        );
        const output = join(root, 'routeTree.gen.ts');
        const config = generator.getConfig(
            { routesDirectory: routes, generatedRouteTree: output, disableLogging: true },
            root
        );
        await new generator.Generator({ config, root }).run();
        expect(readFileSync(join(routes, 'alpha.tsx'), 'utf8')).toContain("createFileRoute('/alpha')");
        expect(readFileSync(output, 'utf8')).toContain("path: '/alpha'");
        expect(readFileSync(output, 'utf8')).toContain('AlphaRoute');
    });

    it('emits actual compiler success and preserves memoization, effects and state invalidation', async () => {
        installDocument();
        const compiled = compileComponent(`import {useEffect, useState} from 'react';
import {Observer} from 'fixture-observer';
export function Widget<Value extends string>({value, onValue}: {value: Value, onValue: (value: string) => void}) {
  const [count, setCount] = useState(0);
  const row = {label: value, count};
  useEffect(() => { onValue(value); }, [onValue, value]);
  return <Observer row={row} onPress={() => setCount(count + 1)} />;
}`);
        expect(compiled.events).toContainEqual(expect.objectContaining({ kind: 'CompileSuccess', fnName: 'Widget' }));
        expect(compiled.events.some((event) => event.kind === 'CompileError')).toBe(false);
        const observed: string[] = [];
        function Observer({ row, onPress }: { row: { label: string; count: number }; onPress: () => void }) {
            observed.push(`${row.label}:${row.count}`);
            return React.createElement('button', { onClick: onPress }, `${row.label}:${row.count}`);
        }
        const executable = transformSync(compiled.code, { loader: 'tsx', jsx: 'automatic', format: 'cjs' }).code;
        const module: {
            exports: Record<string, React.ComponentType<{ value: string; onValue: (value: string) => void }>>;
        } = { exports: {} };
        const load = (name: string) => (name === 'fixture-observer' ? { Observer } : require(name));
        new Function('require', 'module', 'exports', executable)(load, module, module.exports);
        const Widget = module.exports.Widget;
        if (!Widget) {
            throw new Error('The compiled module did not export Widget');
        }
        const onValue = vi.fn();
        const view = render(React.createElement(Widget, { value: 'alpha', onValue }));
        expect(view.getByRole('button').textContent).toBe('alpha:0');
        view.rerender(React.createElement(Widget, { value: 'alpha', onValue }));
        expect(observed).toEqual(['alpha:0']);
        view.rerender(React.createElement(Widget, { value: 'beta', onValue }));
        expect(view.getByRole('button').textContent).toBe('beta:0');
        fireEvent.click(view.getByRole('button'));
        fireEvent.click(view.getByRole('button'));
        expect(view.getByRole('button').textContent).toBe('beta:2');
        expect(observed).toEqual(['alpha:0', 'beta:0', 'beta:1', 'beta:2']);
        expect(onValue.mock.calls).toEqual([['alpha'], ['beta']]);
    });

    it('retains enabled hooks and compiler diagnostics for valid and invalid functions', () => {
        const hooks = require('eslint-plugin-react-hooks');
        const lint = (code: string) =>
            new Linter().verify(code, [
                {
                    languageOptions: {
                        ecmaVersion: 'latest',
                        sourceType: 'module',
                        parserOptions: { ecmaFeatures: { jsx: true } },
                    },
                    plugins: { 'react-hooks': hooks },
                    rules: {
                        'react-hooks/rules-of-hooks': 'error',
                        'react-hooks/immutability': 'error',
                        'react-hooks/unsupported-syntax': 'error',
                    },
                },
            ]);
        expect(
            lint(
                `import {useState} from 'react'; export function Widget(){const [x] = useState(0);return <div>{x}</div>}`
            )
        ).toEqual([]);
        expect(
            lint(`import {useState} from 'react'; export function Widget({ready}){if(ready){useState(0)}return null}`)
        ).toContainEqual(expect.objectContaining({ ruleId: 'react-hooks/rules-of-hooks', severity: 2 }));
        expect(lint(`export function Widget(props){props.value = 1;return <div>{props.value}</div>}`)).toContainEqual(
            expect.objectContaining({ ruleId: 'react-hooks/immutability', severity: 2 })
        );
    });

    it('preserves the existing uncompiled dynamic-import function and its diagnostic', () => {
        const result = compileComponent(
            `export function Widget(){const load=()=>import('./view.js');return <button onClick={load}>Load</button>}`
        );
        // The supported Babel 7 baseline already emits CompileError for this
        // unsupported compiler input while retaining the original function.
        expect(result.events).toContainEqual(expect.objectContaining({ kind: 'CompileError' }));
        expect(result.code).toMatch(/import\(['"]\.\/view\.js['"]\)/u);
        expect(result.code).toContain('onClick={load}');
    });

    it('preserves comments, dynamic imports and bigint literals while editing config', async () => {
        const coverageRequire = createRequire(require.resolve('@vitest/coverage-v8'));
        const magicast = await import(pathToFileURL(coverageRequire.resolve('magicast')).href);
        const module = magicast.parseModule(
            `// Keep config commentary\nexport default { enabled: false, large: 100n, load: () => import('./part.js') };`
        );
        module.exports.default.enabled = true;
        const printed = magicast.generateCode(module).code;
        expect(printed).toContain('// Keep config commentary');
        expect(printed).toContain('enabled: true');
        expect(printed).toContain('100n');
        expect(printed).toMatch(/import\(['"]\.\/part\.js['"]\)/u);
        expect(magicast.parseModule(printed).exports.default.enabled).toBe(true);
    });

    it('writes a bigint config value without silently changing its runtime type', async () => {
        const coverageRequire = createRequire(require.resolve('@vitest/coverage-v8'));
        const magicast = await import(pathToFileURL(coverageRequire.resolve('magicast')).href);
        const module = magicast.parseModule('export default { large: 100n };');
        module.exports.default.large = 101n;
        const printed = magicast.generateCode(module).code;
        expect(printed).toContain('101n');
        expect(magicast.parseModule(printed).exports.default.large).toBe(101n);
        const evaluated = await import(`data:text/javascript,${encodeURIComponent(printed)}`);
        expect(evaluated.default.large).toBe(101n);
    });

    it('loads every shipped runtime-helper import through the public package surface', async () => {
        for (const name of ['@testing-library/dom', '@testing-library/react']) {
            const root = dirname(require.resolve(`${name}/package.json`));
            const localRequire = createRequire(join(root, 'package.json'));
            const visit = (directory: string): string[] =>
                readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
                    entry.isDirectory()
                        ? visit(join(directory, entry.name))
                        : entry.name.endsWith('.js')
                          ? [join(directory, entry.name)]
                          : []
                );
            const helpers = new Set(
                visit(join(root, 'dist')).flatMap((file) =>
                    [...readFileSync(file, 'utf8').matchAll(/['"](@babel\/runtime\/helpers\/[^'"]+)['"]/gu)].map(
                        (match) => {
                            const helper = match[1];
                            if (!helper) {
                                throw new Error('A runtime helper import did not have its captured package path');
                            }
                            return helper;
                        }
                    )
                )
            );
            expect(helpers.size).toBeGreaterThan(0);
            for (const helper of helpers) {
                expect(localRequire.resolve(helper)).toBeTruthy();
            }
            const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
            const esm = await import(pathToFileURL(join(root, metadata.module)).href);
            expect(typeof (name.endsWith('/dom') ? esm.getByRole : esm.render)).toBe('function');
        }
    });

    it('retains real queries, event updates, async wait and useful query errors', async () => {
        installDocument();
        const root = document.createElement('div');
        document.body.append(root);
        try {
            const dom = require('@testing-library/dom');
            const button = document.createElement('button');
            button.textContent = 'Ready';
            root.append(button);
            button.onclick = () => {
                button.textContent = 'Updated';
            };
            dom.fireEvent.click(dom.getByRole(root, 'button', { name: 'Ready' }));
            await waitFor(() => expect(dom.getByRole(root, 'button', { name: 'Updated' })).toBe(button));
            expect(() => dom.getByRole(root, 'textbox', { name: 'Missing field' })).toThrow(
                /Unable to find an accessible element with the role "textbox"/u
            );
            const frame = createRequire(require.resolve('@testing-library/dom'))('@babel/code-frame').codeFrameColumns(
                'first\nconst value = ;\nthird',
                { start: { line: 2, column: 15 } },
                { highlightCode: false }
            );
            expect(frame).toContain('> 2 | const value = ;');
            expect(frame).toContain('^');
        } finally {
            await act(() => root.remove());
        }
    });
});

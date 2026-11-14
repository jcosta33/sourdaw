import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Linter } from 'eslint';
import hooks from 'eslint-plugin-react-hooks';
const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve('@tanstack/router-generator/package.json'));
const outputs = [];
for (const fmt of ['esm', 'cjs']) {
    const root = await mkdtemp(join(tmpdir(), 'router-port-'));
    const routes = join(root, 'routes');
    await mkdir(routes);
    await writeFile(
        join(routes, '__root.tsx'),
        "import {createRootRoute} from '@tanstack/react-router'; export const Route = createRootRoute();\n"
    );
    await writeFile(
        join(routes, 'alpha.tsx'),
        "// 🎹 keep\nimport {createFileRoute} from '@tanstack/react-router'; export const Route = createFileRoute('/wrong')({component: () => <div>Alpha</div>});\n"
    );
    let gen = await import(pathToFileURL(join(pkg, `dist/${fmt}/index.${fmt === 'esm' ? 'js' : 'cjs'}`)).href);
    const tree = join(root, 'routeTree.gen.ts');
    const config = gen.getConfig({ routesDirectory: routes, generatedRouteTree: tree, disableLogging: true }, root);
    await new gen.Generator({ config, root }).run();
    let route = await readFile(join(routes, 'alpha.tsx'), 'utf8');
    let text = await readFile(tree, 'utf8');
    assert.match(route, /🎹 keep/);
    assert.match(route, /createFileRoute\('\/alpha'\)/);
    assert.match(text, /path: '\/alpha'/);
    outputs.push({ route, text });
    await rm(root, { recursive: true, force: true });
}
assert.deepEqual(outputs[0], outputs[1]);
console.log('PASS ESM/CJS generator produces identical route rewrite and tree');
const preset = hooks.configs.flat['recommended-latest'];
const lint = (code) =>
    new Linter().verify(
        code,
        [
            { ...preset, files: ['**/*.jsx'] },
            {
                files: ['**/*.jsx'],
                languageOptions: {
                    ecmaVersion: 'latest',
                    sourceType: 'module',
                    parserOptions: { ecmaFeatures: { jsx: true } },
                },
                rules: {
                    'react-hooks/incompatible-library': 'error',
                    'react-hooks/unsupported-syntax': 'error',
                    'react-hooks/refs': 'warn',
                    'react-hooks/purity': 'warn',
                    'react-hooks/set-state-in-effect': 'warn',
                },
            },
        ],
        { filename: 'fixture.jsx' }
    );
for (const [label, code, rule] of [
    [
        'valid',
        "import {useState} from 'react'; export function Widget(){const [x]=useState(0);return <div>{x}</div>}",
        null,
    ],
    [
        'conditional',
        "import {useState} from 'react'; export function Widget({ready}){if(ready) useState(0);return <div/>}",
        'react-hooks/rules-of-hooks',
    ],
    [
        'stale',
        "import {useEffect} from 'react'; export function Widget({x}){useEffect(()=>{console.log(x)},[]);return <div/>}",
        'react-hooks/exhaustive-deps',
    ],
    [
        'mutation',
        'export function Widget(props){props.value=1;return <div>{props.value}</div>}',
        'react-hooks/immutability',
    ],
    ['syntax', 'export function Widget( { return <div/> }', 'fatal'],
]) {
    let m = lint(code);
    console.log(
        label,
        JSON.stringify(
            m.map(({ ruleId, severity, line, message, fatal }) => ({ ruleId, severity, line, message, fatal }))
        )
    );
    if (rule === null) assert.equal(m.length, 0);
    else if (rule === 'fatal') assert(m.some((x) => x.fatal));
    else assert(m.some((x) => x.ruleId === rule));
}
console.log('PASS real React Hooks preset diagnostics');

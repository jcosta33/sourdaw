// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { cruise, getAvailableTranspilers } from 'dependency-cruiser';
import { describe, expect, it } from 'vitest';

import { readNativeConfiguration } from '../nativeTypeScript';

function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-native-cruise-'));
    for (const [path, text] of Object.entries({
        'package.json': '{"type":"module"}',
        'tsconfig.json':
            '{"compilerOptions":{"paths":{"#/*":["./src/*"]},"jsx":"preserve","module":"esnext","target":"es2022"}}',
        ...files,
    })) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    }
    return root;
}

function modules(output: unknown): unknown[] {
    if (typeof output !== 'string') throw new Error('Cruiser produced no JSON output');
    const parsed: unknown = JSON.parse(output);
    if (!parsed || typeof parsed !== 'object' || !('modules' in parsed) || !Array.isArray(parsed.modules))
        throw new Error('Cruiser graph is malformed');
    return parsed.modules;
}

const scripts = {
    'src/types.ts': 'export type Shape = { id: string };',
    'src/side-effect.js': 'globalThis.nativeCruiseSideEffect = true;',
    'src/lazy.js': 'export const lazy = true;',
    'src/amd.js': 'export const amd = true;',
    'src/modules/Peer/presentations/views/Peer.jsx': 'export const Peer = () => <section>Peer</section>;',
};

describe('installed dependency-cruiser native/Babel consumers', () => {
    it('extracts actual native TS, TSX, JSDoc, AMD, aliases and dynamic edges', async () => {
        const root = fixture({
            ...scripts,
            'src/main.tsx': `/// <amd-dependency path="./amd.js" />
import type { Shape } from '#/types';
import '#/side-effect.js';
import { Peer } from '#/modules/Peer/presentations/views/Peer.jsx';
export const load = () => import('#/lazy.js');
export const Panel = ({ value }: { value: Shape }) => <Peer data-id={value.id} />;
`,
            'src/documented.js': "/** @typedef {import('./types').Shape} Shape */\nexport const documented = true;",
        });
        try {
            const result = await cruise(
                ['src'],
                {
                    baseDir: root,
                    outputType: 'json',
                    tsConfig: { fileName: join(root, 'tsconfig.json') },
                    tsPreCompilationDeps: 'specify',
                    detectJSDocImports: true,
                    doNotFollow: { path: 'node_modules' },
                },
                undefined,
                { tsConfig: readNativeConfiguration(join(root, 'tsconfig.json')) }
            );
            expect(result.exitCode).toBe(0);
            const graph = modules(result.output);
            expect(graph).toContainEqual(
                expect.objectContaining({
                    source: 'src/main.tsx',
                    dependencies: expect.arrayContaining([
                        expect.objectContaining({
                            module: '#/types',
                            resolved: 'src/types.ts',
                            dependencyTypes: expect.arrayContaining(['type-only']),
                        }),
                        expect.objectContaining({ module: '#/side-effect.js', resolved: 'src/side-effect.js' }),
                        expect.objectContaining({ module: '#/lazy.js', resolved: 'src/lazy.js', dynamic: true }),
                        expect.objectContaining({
                            module: '#/modules/Peer/presentations/views/Peer.jsx',
                            resolved: 'src/modules/Peer/presentations/views/Peer.jsx',
                        }),
                        expect.objectContaining({
                            module: './amd.js',
                            resolved: 'src/amd.js',
                            dependencyTypes: expect.arrayContaining(['triple-slash-amd-dependency']),
                        }),
                    ]),
                })
            );
            expect(graph).toContainEqual(
                expect.objectContaining({
                    source: 'src/documented.js',
                    dependencies: expect.arrayContaining([
                        expect.objectContaining({
                            resolved: 'src/types.ts',
                            dependencyTypes: expect.arrayContaining(['jsdoc-bracket-import']),
                        }),
                    ]),
                })
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 30_000);

    it('admits real Babel 8 and observes its transformed JS/JSX import and dynamic dependency names', async () => {
        const root = fixture({
            ...scripts,
            'src/main.jsx':
                "import { peer } from '#/before.js'; export const load = () => import('#/lazy.js'); export const Panel = () => <section>{peer}</section>;",
            'src/before.js': 'export const peer = "wrong branch";',
            'src/after.js': "export { peer } from './modules/Other/presentations/views/peer.js';",
            'src/modules/Other/presentations/views/peer.js': 'export const peer = "actual cross-owner edge";',
        });
        try {
            expect(getAvailableTranspilers()).toContainEqual(
                expect.objectContaining({
                    name: 'babel',
                    available: true,
                    currentVersion: expect.stringMatching(/^@babel\/core@8\./),
                })
            );
            const result = await cruise(
                ['src/main.jsx'],
                {
                    baseDir: root,
                    outputType: 'json',
                    tsConfig: { fileName: join(root, 'tsconfig.json') },
                    tsPreCompilationDeps: false,
                },
                undefined,
                {
                    babelConfig: {
                        babelrc: false,
                        configFile: false,
                        parserOpts: { plugins: ['jsx'] },
                        plugins: [
                            () => ({
                                visitor: {
                                    StringLiteral(path: { node: { value: string } }) {
                                        if (path.node.value === '#/before.js') path.node.value = '#/after.js';
                                    },
                                },
                            }),
                        ],
                    },
                }
            );
            expect(result.exitCode).toBe(0);
            const graph = modules(result.output);
            expect(graph).toContainEqual(
                expect.objectContaining({
                    source: 'src/main.jsx',
                    dependencies: expect.arrayContaining([
                        expect.objectContaining({ module: '#/after.js', resolved: 'src/after.js' }),
                        expect.objectContaining({ module: '#/lazy.js', resolved: 'src/lazy.js', dynamic: true }),
                    ]),
                })
            );
            expect(graph).not.toContainEqual(expect.objectContaining({ source: 'src/before.js' }));
            expect(graph).toContainEqual(
                expect.objectContaining({
                    source: 'src/after.js',
                    dependencies: expect.arrayContaining([
                        expect.objectContaining({ resolved: 'src/modules/Other/presentations/views/peer.js' }),
                    ]),
                })
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 30_000);

    it.each(['src/broken.ts', 'src/broken.jsx'])(
        'refuses malformed %s instead of returning an incomplete graph',
        async (path) => {
            const root = fixture({ [path]: 'export const broken = (' });
            try {
                await expect(
                    cruise([path], { baseDir: root, outputType: 'json', tsPreCompilationDeps: 'specify' })
                ).rejects.toThrow();
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        },
        30_000
    );
});

// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

import { nativeLintCacheIdentity } from '../nativeTypeScript/lintIdentity.mjs';

const require = createRequire(import.meta.url);

it('binds real ESLint process result caches to native compiler and client bytes before parser execution', async () => {
    const repository = process.cwd();
    const config = await new ESLint({ cwd: repository }).calculateConfigForFile(
        resolve(repository, 'src/modules/Arrangement/presentations/views/Panel.tsx')
    );
    expect(config.settings['sourdaw/native-typescript']).toBe(nativeLintCacheIdentity());
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-native-result-cache-'));
    try {
        mkdirSync(join(root, 'scripts'));
        cpSync(join(repository, 'scripts/nativeTypeScript'), join(root, 'scripts/nativeTypeScript'), {
            recursive: true,
        });
        cpSync(join(repository, 'patches'), join(root, 'patches'), { recursive: true });
        for (const name of ['pnpm-lock.yaml', 'eslint.config.mjs']) cpSync(join(repository, name), join(root, name));
        writeFileSync(
            join(root, 'tsconfig.json'),
            JSON.stringify({ compilerOptions: { target: 'ESNext', strict: true }, files: ['input.ts'] })
        );
        writeFileSync(join(root, 'input.ts'), 'export const tone = 7;');
        const moduleURL = (name: string) => JSON.stringify(pathToFileURL(require.resolve(name)).href);
        writeFileSync(
            join(root, 'driver.mjs'),
            `
import { appendFileSync } from 'node:fs';
import { ESLint } from ${moduleURL('eslint')};
import * as parser from ${moduleURL('@typescript-eslint/parser')};
import { getPreparedNativeTypeScriptPath } from ${JSON.stringify(pathToFileURL(resolve(repository, 'scripts/nativeTypeScript/compiler.mjs')).href)};
import { nativeLintLifecycle } from ${JSON.stringify(pathToFileURL(resolve(repository, 'scripts/nativeTypeScript/lintLifecycle.mjs')).href)};
import { nativeLintCacheIdentity } from './scripts/nativeTypeScript/lintIdentity.mjs';
const bind = process.env.BIND_CACHE === '1';
const observer = { ...parser, parseForESLint(...args) {
    appendFileSync(bind ? 'bound-visits' : 'control-visits', 'native-parse\\n');
    return parser.parseForESLint(...args);
} };
try {
    const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: true, cache: true,
        cacheLocation: bind ? '.bound-cache' : '.control-cache',
        overrideConfig: [{ files: ['**/*.ts'],
            languageOptions: { parser: observer, parserOptions: { project: './tsconfig.json', tsconfigRootDir: process.cwd(), nativeCompilerPath: getPreparedNativeTypeScriptPath() } },
            plugins: { lifecycle: nativeLintLifecycle }, rules: { 'lifecycle/release-snapshot': 'error' },
            settings: bind ? { 'sourdaw/native-typescript': nativeLintCacheIdentity() } : {},
        }],
    });
    const results = await eslint.lintFiles(['input.ts']);
    if (results.length !== 1 || results[0].messages.length !== 0) throw new Error(JSON.stringify(results));
    console.log('observed-native-cache-result');
} finally { parser.clearCaches(); }
`
        );
        function run(bind: boolean) {
            const result = spawnSync(process.execPath, ['driver.mjs'], {
                cwd: root,
                encoding: 'utf8',
                timeout: 20_000,
                env: { ...process.env, BIND_CACHE: bind ? '1' : '0' },
            });
            expect(result.error).toBeUndefined();
            expect(result.stderr).toBe('');
            expect(result.status).toBe(0);
            expect(result.stdout.trim()).toBe('observed-native-cache-result');
        }
        const visits = (name: string) => readFileSync(join(root, name), 'utf8').trim().split('\n').length;
        run(true);
        expect(visits('bound-visits')).toBe(1);
        run(true);
        expect(visits('bound-visits')).toBe(1);
        run(false);
        expect(visits('control-visits')).toBe(1);
        const lifecycle = join(root, 'scripts/nativeTypeScript/lintLifecycle.mjs');
        writeFileSync(lifecycle, `${readFileSync(lifecycle, 'utf8')}\n// fingerprint-only source change\n`);
        run(true);
        expect(visits('bound-visits')).toBe(2);
        run(false);
        expect(visits('control-visits')).toBe(1);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 30_000);

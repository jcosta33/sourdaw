// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

const repositoryRoot = join(import.meta.dirname, '../..');
const generator = join(repositoryRoot, 'scripts/generateVersionedCommandArgumentSchemas.mjs');
const generatedPath = 'src/modules/Command/useCases/versionedCommandArgumentKeys.ts';

function runGenerator(root: string, args: string[] = []) {
    return spawnSync(process.execPath, [generator, ...args], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
    });
}

function createFixture(contract: string): string {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-command-schema-'));
    mkdirSync(join(root, 'src/utils'), { recursive: true });
    mkdirSync(join(root, 'src/modules/Command/useCases'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                strict: true,
                target: 'ES2022',
                module: 'ESNext',
                moduleResolution: 'bundler',
                noEmit: true,
                paths: { '#payload': ['./src/utils/payload.ts'] },
            },
        })
    );
    writeFileSync(
        join(root, 'tsconfig.app.json'),
        JSON.stringify({ extends: './tsconfig.json', files: ['src/utils/handlerContract.ts'] })
    );
    writeFileSync(join(root, 'src/utils/handlerContract.ts'), contract);
    return root;
}

describe('generateVersionedCommandArgumentSchemas native checker', () => {
    it('reproduces the tracked AppAction artifact byte for byte without writing it', () => {
        const output = join(repositoryRoot, generatedPath);
        const before = readFileSync(output);
        const result = runGenerator(repositoryRoot, ['--check']);
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(readFileSync(output)).toEqual(before);
    });

    it('generates and executes exact union, optional, tuple, array, recursive and index schemas', () => {
        const root = createFixture(`
import type { Shape } from '#payload';
export type AppAction =
    | { type: 'shapes'; payload: Shape }
    | { type: 'empty' }
    | { type: 'void'; payload: void }
    | { type: 'intersection'; payload: { left: string } & { right: number } };
export type AppActionType = AppAction['type'];
`);
        try {
            writeFileSync(
                join(root, 'src/utils/payload.ts'),
                `
type Tree = { text: string; child?: Tree };
export type Shape = {
    choice: { kind: 'left'; value: string } | { kind: 'right'; value: number };
    optional?: string;
    scalar: 's' | 2 | false | null;
    json: unknown;
    tuple: readonly [string, number];
    array: readonly boolean[];
    record: Record<string, number>;
    mixed: { [key: string]: string | number; [key: number]: number; fixed: string };
    numericOnly: { [key: number]: string };
    tree: Tree;
};
`
            );
            const generated = runGenerator(root);
            expect(generated.error).toBeUndefined();
            expect(generated.signal).toBeNull();
            expect(generated.stderr).toBe('');
            expect(generated.status).toBe(0);
            // Node executes the generated validator. No checker, AST, schema or parser is mocked.
            const validatorJs = transformSync(readFileSync(join(root, generatedPath), 'utf8'), {
                loader: 'ts',
                format: 'esm',
            }).code;
            const validatorUrl = `data:text/javascript;base64,${Buffer.from(validatorJs).toString('base64')}`;
            const probe = spawnSync(
                process.execPath,
                [
                    '--input-type=module',
                    '-e',
                    `
import { validateVersionedCommandArguments as validate } from ${JSON.stringify(validatorUrl)};
const valid = {
    choice: { kind: 'left', value: 'text' }, scalar: 's', json: { nested: [null, 1, false] },
    tuple: ['first', 2], array: [true, false], record: { a: 2 },
    mixed: { fixed: 'text', other: 3 }, numericOnly: {},
    tree: { text: 'root' },
};
const sparse = [true]; sparse.length = 2;
const cases = [
    ['shapes', valid],
    ['shapes', { ...valid, choice: { kind: 'right', value: 3 }, optional: 'present' }],
    ['shapes', { ...valid, choice: { kind: 'left', value: 3 } }],
    ['shapes', { ...valid, choice: { kind: 'other', value: 'text' } }],
    ['shapes', { ...valid, optional: 3 }],
    ['shapes', { ...valid, scalar: 2 }],
    ['shapes', { ...valid, scalar: false }],
    ['shapes', { ...valid, scalar: null }],
    ['shapes', { ...valid, scalar: true }],
    ['shapes', { ...valid, scalar: 'other' }],
    ['shapes', { ...valid, scalar: 1 }],
    ['shapes', { ...valid, json: NaN }],
    ['shapes', { ...valid, json: () => 1 }],
    ['shapes', { ...valid, tuple: ['first'] }],
    ['shapes', { ...valid, tuple: ['first', 2, 3] }],
    ['shapes', { ...valid, tuple: [2, 'first'] }],
    ['shapes', { ...valid, array: [true, 0] }],
    ['shapes', { ...valid, array: sparse }],
    ['shapes', { ...valid, record: { a: 'wrong' } }],
    // Choosing the number index for an object would incorrectly reject this string value.
    ['shapes', { ...valid, mixed: { fixed: 'text', other: 'allowed' } }],
    ['shapes', { ...valid, mixed: { fixed: 'text', other: false } }],
    // Preserve the old generator: a numeric-only object index does not admit arbitrary keys.
    ['shapes', { ...valid, numericOnly: { 0: 'value' } }],
    // Keep the existing closed-object allOf composition; this port does not change its admission.
    ['intersection', { left: 'text', right: 4 }],
    // Recursive references keep the existing JSON-safe cutoff rather than expanding forever.
    ['shapes', { ...valid, tree: { text: 'root', child: { other: [1, null] } } }],
    ['shapes', { ...valid, tree: { text: 'root', child: Infinity } }],
    ['shapes', { ...valid, tree: { text: 3 } }],
    ['shapes', { ...valid, extra: 1 }],
    ['empty', {}], ['empty', { extra: 1 }], ['void', {}], ['unknown', {}],
];
console.log(JSON.stringify(cases.map(([action, value]) => validate(action, value))));
`,
                ],
                { cwd: root, encoding: 'utf8', timeout: 30_000 }
            );
            expect(probe.error).toBeUndefined();
            expect(probe.signal).toBeNull();
            expect(probe.stderr).toBe('');
            expect(probe.status).toBe(0);
            expect(JSON.parse(probe.stdout)).toEqual([
                true,
                true,
                false,
                false,
                false,
                true,
                true,
                true,
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                true,
                false,
                false,
                false,
                true,
                false,
                false,
                false,
                true,
                false,
                true,
                false,
            ]);
            const checked = runGenerator(root, ['--check']);
            expect(checked.error).toBeUndefined();
            expect(checked.status).toBe(0);
            writeFileSync(join(root, generatedPath), '// stale\n');
            const stale = runGenerator(root, ['--check']);
            expect(stale.error).toBeUndefined();
            expect(stale.status).not.toBe(0);
            expect(stale.stderr).toContain('Versioned command argument schemas are stale');
            expect(readFileSync(join(root, generatedPath), 'utf8')).toBe('// stale\n');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 60_000);

    it.each([
        [
            'non-union',
            "export type AppAction = { type: 'one'; payload: string };",
            'AppAction must remain a discriminated union',
        ],
        [
            'non-string discriminator',
            "export type AppAction = { type: number; payload: string } | { type: 'ok' };",
            'AppAction type discriminator must be a string literal',
        ],
        [
            'unsupported primitive',
            "export type AppAction = { type: 'bad'; payload: bigint } | { type: 'ok' };",
            'Unsupported AppAction payload type: bigint',
        ],
        [
            'unresolved type',
            "export type AppAction = { type: 'bad'; payload: MissingPayload } | { type: 'ok' };",
            'Unable to generate AppAction schemas:',
        ],
        [
            'malformed source',
            "export type AppAction = { type: 'bad'; payload: } | { type: 'ok' };",
            'Unable to generate AppAction schemas:',
        ],
    ])('fails closed for %s without replacing the existing output', (_name, contract, message) => {
        const root = createFixture(contract);
        try {
            const output = join(root, generatedPath);
            writeFileSync(output, '// preserved\n');
            const result = runGenerator(root);
            expect(result.error).toBeUndefined();
            expect(result.signal).toBeNull();
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain(message);
            expect(readFileSync(output, 'utf8')).toBe('// preserved\n');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { installedGraph } from '../dependencyPorts/jsToolingInstalled.mjs';

const repository = resolve(import.meta.dirname, '../..');

describe('native Ajv reference-only rule schemas', () => {
    it('preserves real ESLint ref-sibling acceptance and rejection without deprecated-option stderr', () => {
        const result = spawnSync(
            process.execPath,
            [join(import.meta.dirname, 'fixtures/jsToolingDependencyPorts/lint/core.mjs'), 'schemas'],
            { cwd: repository, encoding: 'utf8', timeout: 20_000 }
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout.trim()).toBe(
            JSON.stringify({ case: 'schemas', platform: process.platform, complete: true })
        );
        expect(result.stderr).toBe('$ref: keywords ignored in schema at path \"#/items/0\"\n');
    });

    it('retains the official warning for the deprecated upstream option', () => {
        const eslint = installedGraph(repository).packageRoot('eslint', '10.15.0');
        const owner = createRequire(join(eslint, 'package.json'));
        const result = spawnSync(
            process.execPath,
            [
                '--eval',
                `const Ajv = require(${JSON.stringify(owner.resolve('ajv'))}); new Ajv({ignoreKeywordsWithRef: true});`,
            ],
            { cwd: repository, encoding: 'utf8', timeout: 20_000 }
        );
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('DEPRECATED: option ignoreKeywordsWithRef. \n');
    });
    it('declares the custom option through the actual native TypeScript consumer', () => {
        const graph = installedGraph(repository);
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-ajv-option-types-'));
        try {
            mkdirSync(join(root, 'node_modules/@types'), { recursive: true });
            symlinkSync(graph.packageRoot('ajv', '8.20.0'), join(root, 'node_modules/ajv'), 'junction');
            symlinkSync(graph.packageRoot('@types/node', '26.6.6'), join(root, 'node_modules/@types/node'), 'junction');
            writeFileSync(
                join(root, 'option.mts'),
                `
import { Ajv, type Options } from 'ajv';
const options: Options = { ignoreRefSiblings: true, strictSchema: true };
new Ajv(options);
// @ts-expect-error the reference-only switch must be a boolean
new Ajv({ ignoreRefSiblings: 'yes' });
`
            );
            const result = spawnSync(
                process.execPath,
                [
                    join(graph.packageRoot('typescript', '7.0.2'), 'bin/tsc'),
                    '--ignoreConfig',
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--module',
                    'nodenext',
                    '--target',
                    'esnext',
                    '--types',
                    'node',
                    'option.mts',
                ],
                { cwd: root, encoding: 'utf8', timeout: 20_000 }
            );
            expect(result.error).toBeUndefined();
            expect(result.status, result.stdout + result.stderr).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

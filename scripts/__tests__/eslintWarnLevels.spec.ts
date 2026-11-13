import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { sizeBaselineFiles } from '../../eslint.size-baseline.mjs';

const SIZE_BASELINE =
    'scoped to eslint.size-baseline.mjs files that already exceed the size limits; the list only shrinks';

const SIZE_RULES = ['max-lines', 'max-lines-per-function', 'max-depth', 'complexity'];

type AllowedWarnRule = readonly [entry: string, reason: string];

// The config omits the size-baseline block once the baseline is empty.
function sizeBaselineEntries(): AllowedWarnRule[] {
    if (sizeBaselineFiles.length === 0) {
        return [];
    }
    return SIZE_RULES.map((rule) => [`${sizeBaselineFiles.join(',')}:${rule}`, SIZE_BASELINE]);
}

// Every other rule is at error; its existing violations live in eslint-suppressions.json.
const ALLOWED_WARN_RULES: readonly AllowedWarnRule[] = sizeBaselineEntries();

type ScopedSetting = { scope: string; rule: string; setting: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWarnSeverity(severity: unknown): boolean {
    return severity === 'warn' || severity === 1;
}

function isWarn(setting: unknown): boolean {
    return isWarnSeverity(Array.isArray(setting) ? setting[0] : setting);
}

function isGlobal(config: Record<string, unknown>): boolean {
    return config.files === undefined && config.ignores === undefined;
}

// A nested `files` entry is an AND group, so only a flat list keeps the readable comma form.
function filesKey(files: readonly unknown[]): string {
    return files.some(Array.isArray) ? JSON.stringify(files) : files.join(',');
}

function scopeKey(config: Record<string, unknown>): string {
    const ignores = Array.isArray(config.ignores) ? `!${config.ignores.join(',')}` : undefined;
    if (!Array.isArray(config.files)) {
        return ignores ?? 'global';
    }
    const files = filesKey(config.files);
    return ignores === undefined ? files : `${files} ${ignores}`;
}

function survivingWarnEntries(configs: readonly unknown[]): string[] {
    let settings: ScopedSetting[] = [];
    for (const config of configs) {
        if (!isRecord(config) || !isRecord(config.rules)) {
            continue;
        }
        const global = isGlobal(config);
        const scope = global ? 'global' : scopeKey(config);
        for (const [rule, setting] of Object.entries(config.rules)) {
            settings = settings.filter((entry) => entry.rule !== rule || (!global && entry.scope !== scope));
            settings.push({ scope, rule, setting });
        }
    }
    return settings.filter((entry) => isWarn(entry.setting)).map((entry) => `${entry.scope}:${entry.rule}`);
}

async function loadEslintConfig(): Promise<readonly unknown[]> {
    const loaded: unknown = await import(pathToFileURL(resolve('eslint.config.mjs')).href);
    if (!isRecord(loaded) || !Array.isArray(loaded.default)) {
        throw new Error('eslint.config.mjs must default-export a flat config array');
    }
    return loaded.default;
}

const eslintConfig = await loadEslintConfig();

describe('eslint.config.mjs warn levels', () => {
    it('exports an already flattened array with no extends left to resolve', () => {
        expect(eslintConfig.filter((config) => isRecord(config) && 'extends' in config)).toEqual([]);
    });

    it('configures exactly the tracked rules at warn', () => {
        const allowed = ALLOWED_WARN_RULES.map(([entry]) => entry).sort();
        expect(survivingWarnEntries(eslintConfig).sort()).toEqual(allowed);
    });

    it.each([
        [[{ rules: { a: 'warn' } }], ['global:a']],
        [[{ rules: { a: 1 } }], ['global:a']],
        [[{ rules: { a: ['warn', { option: true }] } }], ['global:a']],
        [[{ files: ['x/**'], rules: { a: 'warn' } }, { rules: { a: 'error' } }], []],
        [[{ rules: { a: 'warn' } }, { files: ['x/**'], rules: { a: 'error' } }], ['global:a']],
        [
            [
                { files: ['x/**'], rules: { a: 'warn' } },
                { files: ['x/**'], rules: { a: 'error' } },
            ],
            [],
        ],
        [[{ ignores: ['x/**'], rules: { a: 'warn' } }], ['!x/**:a']],
        [
            [
                { ignores: ['x/**'], rules: { a: 'warn' } },
                { files: ['y/**'], rules: { a: 'error' } },
            ],
            ['!x/**:a'],
        ],
        [
            [
                { files: ['**/*.tsx'], rules: { a: 'warn' } },
                { files: ['**/*.tsx'], ignores: ['src/**'], rules: { a: 'error' } },
            ],
            ['**/*.tsx:a'],
        ],
        [
            [
                { files: [['**/*.ts', 'src/**']], rules: { a: 'warn' } },
                { files: ['**/*.ts', 'src/**'], rules: { a: 'error' } },
            ],
            ['[["**/*.ts","src/**"]]:a'],
        ],
        [
            [
                { files: ['**/*.tsx'], ignores: ['src/**'], rules: { a: 'warn' } },
                { files: ['**/*.tsx'], ignores: ['src/**'], rules: { a: 'error' } },
            ],
            [],
        ],
        [[{ rules: { a: 'off', b: 'error', c: 2, d: 0, e: ['error'] } }], []],
    ])('reports %j as %j', (configs, expected) => {
        expect(survivingWarnEntries(configs)).toEqual(expected);
    });

    it('fails the lint gate on a new violation of a promoted preset rule', async () => {
        const directory = mkdtempSync(resolve('src/app/eslint-warn-levels-'));
        const fixture = join(directory, 'Comment.tsx');
        const text = 'export const Comment = () => <div>// note</div>;\n';
        try {
            writeFileSync(fixture, text);
            const [result] = await new ESLint().lintText(text, { filePath: fixture });
            if (!result) {
                throw new Error('ESLint returned no result for the fixture');
            }
            const commentMessages = result.messages.filter(
                (message) => message.ruleId === '@eslint-react/jsx-no-comment-textnodes'
            );
            expect(commentMessages.map((message) => message.severity)).toEqual([2]);
        } finally {
            unlinkSync(fixture);
            rmdirSync(directory);
        }
    }, 60_000);

    it('fails a suppressed file on one extra violation and a new file on its first', async () => {
        const directory = mkdtempSync(resolve('src/app/eslint-suppressions-'));
        const suppressed = join(directory, 'suppressed.ts');
        const fresh = join(directory, 'fresh.ts');
        const suppressionsFile = join(directory, 'eslint-suppressions.json');
        const oneVoid = 'export const first = (value: unknown) => void value;\n';
        const twoVoids = `${oneVoid}export const second = (value: unknown) => void value;\n`;
        const voidSeverities = async (eslint: ESLint, text: string, filePath: string) => {
            const [result] = await eslint.lintText(text, { filePath });
            if (!result) {
                throw new Error(`ESLint returned no result for ${filePath}`);
            }
            return result.messages.filter((message) => message.ruleId === 'no-void').map((message) => message.severity);
        };
        try {
            writeFileSync(
                suppressionsFile,
                JSON.stringify({ [relative(process.cwd(), suppressed)]: { 'no-void': { count: 1 } } })
            );
            writeFileSync(suppressed, twoVoids);
            writeFileSync(fresh, oneVoid);
            const eslint = new ESLint({ applySuppressions: true, suppressionsLocation: suppressionsFile });

            expect(await voidSeverities(eslint, oneVoid, suppressed)).toEqual([]);
            expect(await voidSeverities(eslint, twoVoids, suppressed)).toEqual([2, 2]);
            expect(await voidSeverities(eslint, oneVoid, fresh)).toEqual([2]);
        } finally {
            unlinkSync(suppressed);
            unlinkSync(fresh);
            unlinkSync(suppressionsFile);
            rmdirSync(directory);
        }
    }, 60_000);
});

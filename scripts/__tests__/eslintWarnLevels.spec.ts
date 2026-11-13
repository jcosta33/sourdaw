import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import eslintConfig from '../../eslint.config.mjs';
import { sizeBaselineFiles } from '../../eslint.size-baseline.mjs';

const TRACKED_IN_6486 = 'existing violations remain; promotion or baselining tracked in #6486';
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

const ALLOWED_WARN_RULES: readonly AllowedWarnRule[] = [
    ['**/*.{js,jsx,ts,tsx,mts,cts}:no-void', TRACKED_IN_6486],
    ['**/*.{js,jsx,ts,tsx,mts,cts}:sourdaw/no-react-import-outside-ui', TRACKED_IN_6486],
    ['**/*.{ts,mts,cts}:no-restricted-syntax', TRACKED_IN_6486],
    ['**/*.{tsx,jsx}:@eslint-react/purity', TRACKED_IN_6486],
    ['**/*.{tsx,jsx}:@eslint-react/set-state-in-effect', TRACKED_IN_6486],
    ['**/*.{tsx,jsx}:jsx-a11y-x/interactive-supports-focus', TRACKED_IN_6486],
    ['**/*.{tsx,jsx}:react-hooks/purity', TRACKED_IN_6486],
    ['**/*.{tsx,jsx}:react-hooks/refs', TRACKED_IN_6486],
    ['**/*.{tsx,jsx}:react-hooks/set-state-in-effect', TRACKED_IN_6486],
    ['**/*.{tsx,jsx}:sourdaw/no-useeffect-derived-state', TRACKED_IN_6486],
    ['global:@eslint-react/exhaustive-deps', TRACKED_IN_6486],
    ['global:@eslint-react/naming-convention-context-name', TRACKED_IN_6486],
    ['global:@eslint-react/naming-convention-id-name', TRACKED_IN_6486],
    ['global:@eslint-react/naming-convention-ref-name', TRACKED_IN_6486],
    ['global:@eslint-react/no-array-index-key', TRACKED_IN_6486],
    ['global:@eslint-react/no-clone-element', TRACKED_IN_6486],
    ['global:@eslint-react/no-unnecessary-use-prefix', TRACKED_IN_6486],
    ['global:@eslint-react/no-use-context', TRACKED_IN_6486],
    ['global:@eslint-react/purity', TRACKED_IN_6486],
    ['global:@eslint-react/set-state-in-effect', TRACKED_IN_6486],
    ['global:@eslint-react/use-state', TRACKED_IN_6486],
    ['global:@eslint-react/web-api-no-leaked-timeout', TRACKED_IN_6486],
    ['global:react-hooks/exhaustive-deps', TRACKED_IN_6486],
    ...sizeBaselineEntries(),
];

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

function scopeKey(config: Record<string, unknown>): string {
    if (Array.isArray(config.files)) {
        return config.files.flat().join(',');
    }
    if (Array.isArray(config.ignores)) {
        return `!${config.ignores.join(',')}`;
    }
    return 'global';
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

describe('eslint.config.mjs warn levels', () => {
    it('exports an already flattened array with no extends left to resolve', () => {
        expect(eslintConfig.filter((config) => 'extends' in config)).toEqual([]);
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
});

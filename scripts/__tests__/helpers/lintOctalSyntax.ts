import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { clearCaches } from '@typescript-eslint/parser';
import { ESLint } from 'eslint';

/** Exercise the production parser with a real type-aware project admitting every configured extension. */
export async function lintOctalSyntax() {
    const directory = mkdtempSync(resolve('src/app/lint-octal-'));
    const extensions = ['js', 'jsx', 'ts', 'tsx', 'mts', 'cts'] as const;
    const files = extensions.map((extension) => join(directory, `fixture-${extension}.${extension}`));
    const project = join(directory, 'tsconfig.json');
    try {
        for (const file of files) {
            writeFileSync(file, 'export const value = 0o12;\n');
        }
        writeFileSync(
            project,
            JSON.stringify({ compilerOptions: { allowJs: true, jsx: 'preserve', types: [] }, files })
        );
        const production = new ESLint();
        const snapshots = [];
        for (const file of files) {
            const config = await production.calculateConfigForFile(file);
            if (!config || !config.languageOptions?.parser) {
                throw new Error(`The production parser is missing for ${file}`);
            }
            const lint = async (code: string, rule: 'error' | 'off') => {
                const eslint = new ESLint({
                    overrideConfigFile: true,
                    overrideConfig: [
                        {
                            files: ['**/*.{js,jsx,ts,tsx,mts,cts}'],
                            languageOptions: {
                                ...config.languageOptions,
                                parserOptions: { ...config.languageOptions.parserOptions, project },
                            },
                            rules: { 'no-octal': rule },
                        },
                    ],
                });
                const [result] = await eslint.lintText(code, { filePath: file });
                if (!result) {
                    throw new Error(`ESLint did not lint ${file}`);
                }
                return result.messages;
            };
            snapshots.push({
                extension: file.slice(file.lastIndexOf('.') + 1),
                sourceType: config.languageOptions.sourceType,
                activeRule: config.rules['no-octal'],
                legacyOn: await lint('export const value = 012;\n', 'error'),
                legacyOff: await lint('export const value = 012;\n', 'off'),
                modernOn: await lint(readFileSync(file, 'utf8'), 'error'),
                modernOff: await lint(readFileSync(file, 'utf8'), 'off'),
                escapeOff: await lint('export const value = "\\1";\n', 'off'),
            });
        }
        const outside = await Promise.all(
            ['mjs', 'cjs'].map(async (extension) => {
                const config = await production.calculateConfigForFile(join(directory, `control.${extension}`));
                return { extension, activeRule: config?.rules['no-octal'] };
            })
        );
        return { snapshots, outside };
    } finally {
        clearCaches();
        rmSync(directory, { recursive: true, force: true });
    }
}

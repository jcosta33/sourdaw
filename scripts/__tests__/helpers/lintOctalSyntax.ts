import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { clearCaches } from '@typescript-eslint/parser';
import { ESLint } from 'eslint';

const octalCases = {
    legacyOn: { code: 'export const value = 012;\n', rule: 'error' },
    legacyOff: { code: 'export const value = 012;\n', rule: 'off' },
    modernOn: { code: 'export const value = 0o12;\n', rule: 'error' },
    modernOff: { code: 'export const value = 0o12;\n', rule: 'off' },
    escapeOn: { code: 'export const value = "\\1";\n', rule: 'error' },
    escapeOff: { code: 'export const value = "\\1";\n', rule: 'off' },
} as const;

function writeOctalFixtures(directory: string, extensions: readonly string[]) {
    const files: string[] = [];
    for (const extension of extensions) {
        for (const [name, fixture] of Object.entries(octalCases)) {
            const file = join(directory, `${extension}-${name}.${extension}`);
            writeFileSync(file, fixture.code);
            files.push(file);
        }
    }
    return files;
}

async function syntaxSnapshot(production: ESLint, directory: string, extension: string, project?: string) {
    const config = await production.calculateConfigForFile(join(directory, `${extension}-legacyOn.${extension}`));
    if (!config?.languageOptions?.parser) {
        throw new Error(`The production parser is missing for ${extension}`);
    }
    let languageOptions = config.languageOptions;
    if (project !== undefined) {
        languageOptions = {
            ...config.languageOptions,
            parserOptions: { ...config.languageOptions.parserOptions, project },
        };
    }
    const lint = async (name: keyof typeof octalCases) => {
        const file = join(directory, `${extension}-${name}.${extension}`);
        const fixture = octalCases[name];
        if (readFileSync(file, 'utf8') !== fixture.code) {
            throw new Error(`Octal fixture bytes changed before linting ${file}`);
        }
        const eslint = new ESLint({
            overrideConfigFile: true,
            overrideConfig: [
                {
                    files: ['**/*.{js,jsx,ts,tsx,mts,cts}'],
                    languageOptions,
                    rules: { 'no-octal': fixture.rule },
                },
            ],
        });
        const results = await eslint.lintFiles([file]);
        const [result] = results;
        if (results.length !== 1 || !result || result.filePath !== file) {
            throw new Error(`ESLint did not lint the exact octal fixture ${file}`);
        }
        return result.messages;
    };
    return {
        extension,
        sourceType: languageOptions.sourceType,
        project: languageOptions.parserOptions?.project,
        activeRule: config.rules['no-octal'],
        legacyOn: await lint('legacyOn'),
        legacyOff: await lint('legacyOff'),
        modernOn: await lint('modernOn'),
        modernOff: await lint('modernOff'),
        escapeOn: await lint('escapeOn'),
        escapeOff: await lint('escapeOff'),
    };
}

/** Exercise the production parser with a real type-aware project admitting every configured extension. */
export async function lintOctalSyntax() {
    const directory = mkdtempSync(resolve('src/app/lint-octal-'));
    const extensions = ['js', 'jsx', 'ts', 'tsx', 'mts', 'cts'] as const;
    const project = join(directory, 'tsconfig.json');
    let scriptDirectory: string | undefined;
    try {
        scriptDirectory = mkdtempSync(resolve('scripts/lint-octal-'));
        const files = writeOctalFixtures(directory, extensions);
        writeOctalFixtures(scriptDirectory, ['js']);
        writeFileSync(
            project,
            JSON.stringify({ compilerOptions: { allowJs: true, jsx: 'preserve', types: [] }, files })
        );
        // CI infers immutable single-run programs. Every syntax/rule pair must
        // already have its own matching disk bytes before any program is built.
        clearCaches();
        const production = new ESLint();
        const snapshots = [];
        for (const extension of extensions) {
            snapshots.push(await syntaxSnapshot(production, directory, extension, project));
        }
        const script = await syntaxSnapshot(production, scriptDirectory, 'js');
        const outside = await Promise.all(
            ['mjs', 'cjs'].map(async (extension) => {
                const config = await production.calculateConfigForFile(join(directory, `control.${extension}`));
                return { extension, activeRule: config?.rules['no-octal'] };
            })
        );
        return { snapshots, script, outside };
    } finally {
        clearCaches();
        if (scriptDirectory !== undefined) {
            rmSync(scriptDirectory, { recursive: true, force: true });
        }
        rmSync(directory, { recursive: true, force: true });
    }
}

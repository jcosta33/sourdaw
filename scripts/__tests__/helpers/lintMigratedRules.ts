import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { type Linter } from 'eslint';

type Diagnostic = { ruleId: string; message: string; severity: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

// The sequential integration suite owns every caller so another worker cannot
// remove a workspace fixture while a native TypeScript program is loading it.
export function withLintFixture<Result>(code: string, filename: string, inspect: (fixture: string) => Result): Result {
    const inModule = filename.startsWith('src/modules/Example/');
    const parent =
        ['scripts', 'electron', 'tests/e2e', 'server'].find((path) => filename.startsWith(`${path}/`)) ?? 'src/app';
    const directory = mkdtempSync(resolve(inModule ? 'src/modules/LintMigration-' : `${parent}/lint-migration-`));
    const suffix = inModule ? filename.slice('src/modules/Example/'.length) : basename(filename);
    // The standalone server project intentionally includes only root-level *.ts.
    const fixture = parent === 'server' ? `${directory}-${suffix}` : join(directory, suffix);
    const text = inModule ? code.replaceAll('#/modules/Example/', `#/modules/${basename(directory)}/`) : code;
    try {
        mkdirSync(dirname(fixture), { recursive: true });
        writeFileSync(fixture, text);
        return inspect(fixture);
    } finally {
        if (parent === 'server') {
            rmSync(fixture, { force: true });
        }
        rmSync(directory, { recursive: true, force: true });
    }
}

function lintOxlintFixture(fixture: string, config: string, fix: boolean, root = process.cwd()) {
    const args = [`--config=${config}`, '--threads=2', '--format=json'];
    if (fix) {
        args.push('--fix');
    }
    args.push(fixture);
    const result = spawnSync(resolve('node_modules/.bin/oxlint'), args, {
        cwd: root,
        encoding: 'utf8',
        timeout: 60_000,
    });
    if (result.error || (result.status !== 0 && result.status !== 1)) {
        throw new Error(`Oxlint did not complete: ${result.error?.message ?? result.stderr}`);
    }
    const output: unknown = JSON.parse(result.stdout);
    if (!isRecord(output) || !Array.isArray(output.diagnostics) || output.number_of_files !== 1) {
        throw new Error(`Oxlint returned no diagnostic array: ${result.stdout}${result.stderr}`);
    }
    const messages: Diagnostic[] = output.diagnostics.map((entry: unknown) => {
        if (!isRecord(entry) || typeof entry.code !== 'string' || typeof entry.message !== 'string') {
            throw new Error(`Oxlint returned an invalid diagnostic: ${JSON.stringify(entry)}`);
        }
        return {
            ruleId: entry.code.replace(/\(([^)]+)\)$/, '/$1'),
            message: entry.message,
            severity: String(entry.severity),
        };
    });
    return {
        messages,
        status: result.status,
        output: result.stdout + result.stderr,
        text: readFileSync(resolve(root, fixture), 'utf8'),
    };
}

/** Run the production public-plugin config on a real file with its normal filename policy. */
export function lintMigratedRules(code: string, filename = 'src/app/example.ts', fix = false) {
    return withLintFixture(code, filename, (fixture) => lintOxlintFixture(fixture, '.oxlint-plugins.json', fix));
}

/** Read-only probe of a real baseline path, so literal warning scopes are exercised. */
export function lintMigratedFile(filename: string) {
    return lintOxlintFixture(resolve(filename), '.oxlint-plugins.json', false);
}

/** Exercise the complete production policy at its literal baseline path without editing source. */
export function lintBaselineMigratedRules(code: string) {
    const root = mkdtempSync(join(tmpdir(), 'lint-warning-policy-'));
    const config = resolve('.oxlint-plugins.json');
    const copiedConfig = join(root, '.oxlint-plugins.json');
    const fixture = 'scripts/resourceGuard.ts';
    try {
        copyFileSync(config, copiedConfig);
        mkdirSync(join(root, 'scripts'));
        symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
        symlinkSync(resolve('scripts/lint'), join(root, 'scripts/lint'), 'dir');
        writeFileSync(join(root, fixture), code);
        if (!readFileSync(config).equals(readFileSync(copiedConfig))) {
            throw new Error('The isolated fixture must retain identical production config bytes');
        }
        return lintOxlintFixture(fixture, '.oxlint-plugins.json', false, root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

/** Probe a stock native candidate independently when its semantics prevent migration. */
export function lintNativeCoreRule(code: string, rule: string, setting: Linter.RuleEntry, typeAware = false) {
    return withLintFixture(code, 'src/app/example.ts', (fixture) => {
        const config = join(dirname(fixture), 'candidate.json');
        writeFileSync(
            config,
            JSON.stringify({
                plugins: ['typescript'],
                categories: {
                    correctness: 'off',
                    suspicious: 'off',
                    pedantic: 'off',
                    perf: 'off',
                    style: 'off',
                    restriction: 'off',
                    nursery: 'off',
                },
                options: { typeAware },
                rules: { [rule]: setting },
            })
        );
        return lintOxlintFixture(fixture, config, false);
    });
}

export function runProductionLint(code: string, filename: string, fix = false) {
    return withLintFixture(code, filename, (fixture) => {
        const args = ['scripts/runLint.ts'];
        if (fix) {
            args.push('--fix');
        }
        args.push(relative(process.cwd(), fixture));
        const result = spawnSync(process.execPath, args, {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 120_000,
            env: { ...process.env, npm_config_verify_deps_before_run: 'false' },
        });
        if (result.error) {
            throw new Error(`Lint runner did not complete: ${result.error.message}`);
        }
        return { status: result.status, output: result.stdout + result.stderr, text: readFileSync(fixture, 'utf8') };
    });
}

/** Freeze the old core-rule behavior independently of the production engine assignment. */
export function lintLegacyCoreRule(code: string, rule: string, setting: Linter.RuleEntry) {
    const query = `
        import { ESLint } from 'eslint';
        import tseslint from 'typescript-eslint';
        const [rule, setting, code] = JSON.parse(process.argv[1]);
        const eslint = new ESLint({
            overrideConfigFile: true,
            overrideConfig: [{
                files: ['**/*.ts'],
                languageOptions: { parser: tseslint.parser },
                rules: { [rule]: setting },
            }],
        });
        const [result] = await eslint.lintText(code, { filePath: 'legacy-core.ts' });
        console.log(JSON.stringify(result.messages));
    `;
    const result = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', query, JSON.stringify([rule, setting, code])],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 60_000,
        }
    );
    if (result.status !== 0 || result.error) {
        throw new Error(
            `Legacy ESLint did not complete: ${result.stdout}${result.stderr}${result.error?.message ?? ''}`
        );
    }
    const messages: unknown = JSON.parse(result.stdout);
    if (
        !Array.isArray(messages) ||
        !messages.every((message) => isRecord(message) && typeof message.ruleId === 'string')
    ) {
        throw new Error(`Legacy ESLint returned invalid diagnostics: ${result.stdout}`);
    }
    return messages;
}

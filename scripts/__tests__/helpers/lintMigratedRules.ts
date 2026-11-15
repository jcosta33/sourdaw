import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

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

/** Run the production public-plugin config on a real file with its normal filename policy. */
export function lintMigratedRules(code: string, filename = 'src/app/example.ts', fix = false) {
    return withLintFixture(code, filename, (fixture) => {
        const args = ['--config=.oxlint-plugins.json', '--threads=2', '--format=json'];
        if (fix) {
            args.push('--fix');
        }
        args.push(fixture);
        const result = spawnSync(resolve('node_modules/.bin/oxlint'), args, {
            cwd: process.cwd(),
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
            text: readFileSync(fixture, 'utf8'),
        };
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

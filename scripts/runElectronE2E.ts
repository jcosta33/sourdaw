/**
 * Build the shell this checkout is about to exercise, then run one finite
 * Electron Playwright configuration. `electron/out/` is ignored and shared by
 * prior dev work, so existence cannot establish that an E2E launch used this
 * lane's main/preload sources.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type BuildMode = '--dev' | '--packaged';

type Provenance = {
    head: string;
    files: Record<string, string>;
};

function run(command: string, args: readonly string[]): void {
    const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit' });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} exited ${String(result.status)}`);
    }
}

function output(command: string, args: readonly string[]): string {
    const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8' });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} exited ${String(result.status)}`);
    }
    return result.stdout.trim();
}

function digest(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeProvenance(path: string, files: readonly string[]): void {
    for (const file of files) {
        if (!existsSync(file)) {
            throw new Error(`Electron E2E build did not produce ${file}`);
        }
    }
    const provenance: Provenance = {
        head: output('git', ['rev-parse', 'HEAD']),
        files: Object.fromEntries(files.map((file) => [file, digest(file)])),
    };
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(provenance)}\n`, 'utf8');
}

function buildDevShell(): void {
    run('pnpm', ['build']);
    run('pnpm', ['exec', 'tsc', '-p', 'electron/tsconfig.dev.json']);
    run(process.execPath, ['scripts/buildElectronPreload.ts']);
    run(process.execPath, ['scripts/buildNativeAddon.ts']);
    writeProvenance(join('electron', 'out', 'ddsp-e2e-provenance.json'), [
        join('electron', 'out', 'main.js'),
        join('electron', 'out', 'preload.cjs'),
    ]);
}

function packagedExecutable(): string {
    if (process.platform !== 'darwin') {
        throw new Error(`Packaged DDSP CSP proof is maintained on macOS, received ${process.platform}`);
    }
    return join('release', 'desktop', `mac-${process.arch}`, 'Sourdaw.app', 'Contents', 'MacOS', 'Sourdaw');
}

function buildPackagedShell(): void {
    run('pnpm', ['desktop:build']);
    const executable = packagedExecutable();
    writeProvenance(join('release', 'desktop', 'ddsp-csp-e2e-provenance.json'), [executable]);
}

const [mode, config] = process.argv.slice(2) as [BuildMode | undefined, string | undefined];
if ((mode !== '--dev' && mode !== '--packaged') || config === undefined) {
    throw new Error('Usage: runElectronE2E.ts <--dev|--packaged> <playwright-config>');
}

if (mode === '--dev') {
    buildDevShell();
} else {
    buildPackagedShell();
}
run('pnpm', ['exec', 'playwright', 'test', '--config', config]);

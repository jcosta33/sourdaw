/**
 * Build the shell this checkout is about to exercise, then run one finite
 * Electron Playwright configuration. `electron/out/` is ignored and shared by
 * prior dev work, so existence cannot establish that an E2E launch used this
 * lane's main/preload sources.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

type BuildMode = '--dev' | '--packaged';

export type FileProvenance = {
    head: string;
    files: Record<string, string>;
};

export type PackagedProvenance = FileProvenance & {
    schemaVersion: 2;
    unpacked: { path: string; state: 'absent' } | { path: string; state: 'present'; files: Record<string, string> };
};

export const PACKAGED_BUILD_INPUTS = [
    'package.json',
    'pnpm-lock.yaml',
    'Cargo.toml',
    'Cargo.lock',
    'electron-builder.yml',
    'vite.config.ts',
    'tsconfig.json',
    'tsconfig.app.json',
    'electron',
    'src',
    'public',
    'crates',
    'build',
    'scripts/buildElectronPreload.ts',
    'scripts/buildNativeAddon.ts',
    'scripts/electronRuntimeContract.ts',
    'scripts/flipElectronFuses.ts',
] as const;

function run(command: string, args: readonly string[]): void {
    const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit' });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} exited ${String(result.status)}`);
    }
}

function output(command: string, args: readonly string[], cwd = process.cwd()): string {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
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

function relativePath(root: string, path: string): string {
    return relative(root, path).split(sep).join('/');
}

function writeProvenance(path: string, files: readonly string[]): void {
    for (const file of files) {
        if (!existsSync(file)) {
            throw new Error(`Electron E2E build did not produce ${file}`);
        }
    }
    const provenance: FileProvenance = {
        head: output('git', ['rev-parse', 'HEAD']),
        files: Object.fromEntries(files.map((file) => [file, digest(file)])),
    };
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(provenance)}\n`, 'utf8');
}

function packagedContents(root: string, arch: NodeJS.Architecture): string {
    return join(root, 'release', 'desktop', `mac-${arch}`, 'Sourdaw.app', 'Contents');
}

function packagedPaths(root: string, arch: NodeJS.Architecture) {
    const contents = packagedContents(root, arch);
    return {
        executable: join(contents, 'MacOS', 'Sourdaw'),
        appAsar: join(contents, 'Resources', 'app.asar'),
        infoPlist: join(contents, 'Info.plist'),
        unpacked: join(contents, 'Resources', 'app.asar.unpacked'),
    };
}

function directoryDigests(root: string, directory: string): Record<string, string> {
    const entries: Array<[string, string]> = [];
    const visit = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) =>
            left.name.localeCompare(right.name)
        )) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) {
                visit(path);
                continue;
            }
            const value = lstatSync(path).isSymbolicLink()
                ? createHash('sha256')
                      .update(`symlink:${readlinkSync(path)}`)
                      .digest('hex')
                : digest(path);
            entries.push([relativePath(root, path), value]);
        }
    };
    visit(directory);
    return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function hasAsarIntegrityMetadata(infoPlist: string): boolean {
    const contents = readFileSync(infoPlist, 'utf8');
    return contents.includes('ElectronAsarIntegrity') && contents.includes('Resources/app.asar');
}

export function assertPackagedBuildInputsClean(root = process.cwd()): void {
    const result = spawnSync(
        'git',
        ['status', '--porcelain=v1', '--untracked-files=no', '--', ...PACKAGED_BUILD_INPUTS],
        { cwd: root, encoding: 'utf8' }
    );
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`git status exited ${String(result.status)}`);
    }
    const dirty = result.stdout.trim();
    if (dirty !== '') {
        throw new Error(`dirty tracked packaged-build inputs:\n${dirty}`);
    }
}

export function createPackagedProvenance(root: string, arch: NodeJS.Architecture, head: string): PackagedProvenance {
    const paths = packagedPaths(root, arch);
    for (const path of [paths.executable, paths.appAsar, paths.infoPlist]) {
        if (!existsSync(path)) {
            throw new Error(`Electron E2E build did not produce ${relativePath(root, path)}`);
        }
    }
    if (!hasAsarIntegrityMetadata(paths.infoPlist)) {
        throw new Error('Packaged Info.plist does not carry ElectronAsarIntegrity for Resources/app.asar');
    }

    const files = Object.fromEntries(
        [paths.appAsar, paths.infoPlist, paths.executable]
            .map((path) => [relativePath(root, path), digest(path)] as const)
            .sort(([left], [right]) => left.localeCompare(right))
    );
    const unpackedPath = relativePath(root, paths.unpacked);
    return {
        schemaVersion: 2,
        head,
        files,
        unpacked: existsSync(paths.unpacked)
            ? { path: unpackedPath, state: 'present', files: directoryDigests(root, paths.unpacked) }
            : { path: unpackedPath, state: 'absent' },
    };
}

export function validatePackagedProvenance(
    root: string,
    arch: NodeJS.Architecture,
    provenance: PackagedProvenance
): string[] {
    const errors: string[] = [];
    const paths = packagedPaths(root, arch);
    for (const path of [paths.appAsar, paths.infoPlist, paths.executable]) {
        const id = relativePath(root, path);
        if (!existsSync(path)) {
            errors.push(`${id}: packaged output missing`);
        } else if (provenance.files[id] !== digest(path)) {
            errors.push(`${id}: packaged output drifted`);
        }
    }
    if (existsSync(paths.infoPlist) && !hasAsarIntegrityMetadata(paths.infoPlist)) {
        errors.push(`${relativePath(root, paths.infoPlist)}: ElectronAsarIntegrity missing`);
    }

    const unpackedPath = relativePath(root, paths.unpacked);
    if (!existsSync(paths.unpacked)) {
        if (provenance.unpacked.path !== unpackedPath || provenance.unpacked.state !== 'absent') {
            errors.push(`${unpackedPath}: absence provenance drifted`);
        }
    } else if (
        provenance.unpacked.path !== unpackedPath ||
        provenance.unpacked.state !== 'present' ||
        JSON.stringify(provenance.unpacked.files) !== JSON.stringify(directoryDigests(root, paths.unpacked))
    ) {
        errors.push(`${unpackedPath}: unpacked provenance drifted`);
    }
    return errors;
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

function buildPackagedShell(): void {
    if (process.platform !== 'darwin') {
        throw new Error(`Packaged DDSP CSP proof is maintained on macOS, received ${process.platform}`);
    }
    assertPackagedBuildInputsClean();
    run('pnpm', ['desktop:build']);
    const provenance = createPackagedProvenance(process.cwd(), process.arch, output('git', ['rev-parse', 'HEAD']));
    const provenancePath = join('release', 'desktop', 'ddsp-csp-e2e-provenance.json');
    mkdirSync(join(provenancePath, '..'), { recursive: true });
    writeFileSync(provenancePath, `${JSON.stringify(provenance)}\n`, 'utf8');
}

function main(): void {
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
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
    main();
}

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { extractFile, listPackage, statFile } from '@electron/asar';
import { flipFuses, FuseV1Options, FuseVersion, getCurrentFuseWire, pathToFuseFile } from '@electron/fuses';

import {
    findFuseMismatches,
    resolveElectronBinaryPath,
    verifyStagedElectronLegalFiles,
    type AfterPackContext,
} from './flipElectronFuses.ts';
import { copyDesktopPayload } from './isolatedDesktopCopy.ts';
import { verifyPackagedNativeArtifacts } from './verifyPackagedNativeArtifacts.ts';

function digest(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

async function files(root: string): Promise<string[]> {
    const result: string[] = [];
    async function visit(directory: string): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) await visit(path);
            else if (entry.isFile()) result.push(relative(root, path).split(sep).join('/'));
            else throw new Error(`Unexpected non-file resource: ${path}`);
        }
    }
    await visit(root);
    return result.sort();
}

function allowedAsarFile(path: string): boolean {
    return (
        !path.split('/').some((part) => part === '..' || part === '.') &&
        (path === 'package.json' || path.startsWith('dist/') || path.startsWith('electron/out/')) &&
        !path.split('/').some((part) => part === 'node_modules' || part === '__tests__') &&
        !path.startsWith('dist/samples/') &&
        !path.endsWith('.map')
    );
}

export async function verifyAsar(asar: string, projectRoot: string): Promise<void> {
    const paths = listPackage(asar, { isPack: false }).map((item) => item.replace(/^[/\\]+/, '').replaceAll('\\', '/'));
    const entries = paths.filter((path) => {
        const entry = statFile(asar, path, false);
        if ('link' in entry) throw new Error(`Unexpected asar link: ${path}`);
        if ('files' in entry) {
            if (path !== 'electron' && !allowedAsarFile(`${path}/placeholder`)) {
                throw new Error(`Unexpected asar directory: ${path}`);
            }
            return false;
        }
        return true;
    });
    const actual = new Set(entries);
    if (actual.size !== entries.length) throw new Error('Duplicate asar entries');
    for (const name of entries) {
        if (!allowedAsarFile(name)) throw new Error(`Unexpected asar entry: ${name}`);
        if (name !== 'package.json') {
            const source = await readFile(join(projectRoot, name));
            if (digest(extractFile(asar, name)) !== digest(source)) throw new Error(`Asar content differs: ${name}`);
        }
    }
    for (const prefix of ['dist', 'electron/out']) {
        for (const name of await files(join(projectRoot, prefix))) {
            const path = `${prefix}/${name}`;
            if (allowedAsarFile(path) && !actual.has(path)) throw new Error(`Missing asar entry: ${path}`);
        }
    }
    for (const required of ['package.json', 'dist/index.html', 'electron/out/main.js']) {
        if (!actual.has(required)) throw new Error(`Missing asar entry: ${required}`);
    }
    const source: unknown = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
    const packaged: unknown = JSON.parse(extractFile(asar, 'package.json').toString('utf8'));
    if (typeof source !== 'object' || source === null || typeof packaged !== 'object' || packaged === null) {
        throw new Error('Invalid packaged or source manifest');
    }
    for (const field of ['name', 'version', 'type', 'main']) {
        const expected: unknown = Reflect.get(source, field);
        if (typeof expected !== 'string' || expected.length === 0 || Reflect.get(packaged, field) !== expected) {
            throw new Error(`Packaged manifest differs: ${field}`);
        }
    }
    const main: unknown = Reflect.get(packaged, 'main');
    if (typeof main !== 'string' || !allowedAsarFile(main) || !actual.has(main)) {
        throw new Error('Packaged manifest main is not a permitted asar file');
    }
}

export async function verifyResourceTree(
    source: string,
    destination: string,
    extra: readonly string[] = []
): Promise<void> {
    const expected = await files(source);
    const actual = await files(destination);
    if (JSON.stringify(actual) !== JSON.stringify([...expected, ...extra].sort())) {
        throw new Error(`Resource inventory differs: ${destination}`);
    }
    for (const name of expected) {
        if (digest(await readFile(join(source, name))) !== digest(await readFile(join(destination, name)))) {
            throw new Error(`Resource bytes differ: ${name}`);
        }
    }
}

async function requireFuses(binary: string): Promise<void> {
    const errors = findFuseMismatches(await getCurrentFuseWire(binary));
    if (errors.length) throw new Error(`Wrong fuses: ${errors.join('; ')}`);
}

export async function verifyDesktopPayload(
    appOutDir: string,
    platform: string,
    arch: number,
    projectRoot: string
): Promise<void> {
    const context: AfterPackContext = {
        appOutDir,
        electronPlatformName: platform,
        arch,
        packager: {
            appInfo: { productFilename: 'Sourdaw' },
            ...(platform === 'linux' ? { executableName: 'sourdaw' } : {}),
        },
    };
    const binary = resolveElectronBinaryPath(context);
    const resources = platform === 'darwin' ? join(binary, 'Contents', 'Resources') : join(appOutDir, 'resources');
    await verifyAsar(join(resources, 'app.asar'), projectRoot);
    try {
        await stat(join(resources, 'app.asar.unpacked'));
        throw new Error('Unexpected app.asar.unpacked');
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await verifyResourceTree(join(projectRoot, 'public', 'samples'), join(resources, 'samples'));
    await verifyResourceTree(join(projectRoot, 'public', 'legal'), join(resources, 'legal'), [
        'electron-LICENSE.txt',
        'electron-LICENSES.chromium.html',
    ]);
    await verifyStagedElectronLegalFiles(context);
    await verifyPackagedNativeArtifacts(resources, platform, arch);
    await requireFuses(binary);

    // This negative control mutates a disposable copy of the actual extracted binary.
    const temp = await mkdtemp(join(tmpdir(), 'sourdaw-fuse-control-'));
    try {
        const copy = join(temp, basename(binary));
        await copyDesktopPayload(binary, copy, pathToFuseFile(copy));
        await flipFuses(copy, { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: true });
        let rejected = false;
        try {
            await requireFuses(copy);
        } catch (error) {
            if (!(error instanceof Error) || !error.message.includes('RunAsNode:')) throw error;
            rejected = true;
        }
        if (!rejected) throw new Error('Fuse negative control was not detected');
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [appOutDir, platform, arch] = process.argv.slice(2);
    if (!appOutDir || !platform || !arch || !['darwin:3', 'linux:1', 'win32:1'].includes(`${platform}:${arch}`)) {
        throw new Error('Usage: verifyDesktopPayload <app-output-directory> <darwin|linux|win32> <builder-arch>');
    }
    await verifyDesktopPayload(resolve(appOutDir), platform, Number(arch), process.cwd());
}

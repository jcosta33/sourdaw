import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    linkSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

import { parsePnpmLock } from './pnpmLock.ts';

import { wasmToolchainPins } from './wasmToolchainPins.ts';

/** Keep authenticated build tools on their platform loaders' normal library routes. */
export function wasmGenerationEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    return Object.fromEntries(
        Object.entries(source).filter(
            ([key]) => !key.startsWith('DYLD_') && !['LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT'].includes(key)
        )
    );
}

export const binaryenRelease = 'version_133';
const archivePins: Readonly<Record<string, { archive: string; sha256: string; size: number }>> = {
    'linux-x64': {
        archive: 'binaryen-version_133-x86_64-linux.tar.gz',
        sha256: '2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489',
        size: 111200018,
    },
    'linux-arm64': {
        archive: 'binaryen-version_133-aarch64-linux.tar.gz',
        sha256: '89c07ea56faf38d0fbecf36ca8ec0721756716185f265b568e133d427f299bf8',
        size: 105577739,
    },
    'darwin-x64': {
        archive: 'binaryen-version_133-x86_64-macos.tar.gz',
        sha256: '13a9b90be775c6389ce3d1f879cb8627bea56708ba8c122983941d53a8199b95',
        size: 9276271,
    },
    'darwin-arm64': {
        archive: 'binaryen-version_133-arm64-macos.tar.gz',
        sha256: 'ad66da82ac13f163e424b1643f16c6dfcccc98b5966296b43e52d3cab04f84a8',
        size: 7810532,
    },
    'win32-x64': {
        archive: 'binaryen-version_133-x86_64-windows.tar.gz',
        sha256: '17a2cbeac6b5693c5fbafab3838d3c65fd9c1eb38b05f5baec6c657e8c84995b',
        size: 111045528,
    },
    'win32-arm64': {
        archive: 'binaryen-version_133-arm64-windows.tar.gz',
        sha256: '492a8e1847a0be1554bb9a7f384227981d60bc013aedc02d8ba1372c3943178c',
        size: 109735160,
    },
};
/** Extracted from the SHA-256 authenticated official version_133 host archives. */
export const binaryenExecutablePins: Readonly<Record<string, string>> = {
    'darwin-arm64': '81041e09f332df94db1c2009a64d8f3b85f0431a2c920ccd014d3ceebb343402',
    'darwin-x64': 'e26344b1d0d0986ac4a1090f58e478470eb2a52ba0625ae9a0f880511bb31d51',
    'linux-x64': '8f25e9fd5db0fc5f210003aaa432922feb2e52d309e430def2f929e34da9466b',
    'linux-arm64': 'e5a823487bb83ed522625cc5d9c383e94e0479bfdb1ba387a387505df27daa6a',
    'win32-x64': '4217d75f81cf33c4032d82b5d531120069af1a4b43eb7737977bdb2c99a8f4ba',
    'win32-arm64': 'd6c01791133b2eded195b6461e9393de02a9bc36bdc3379918870780ca1c6a4d',
};

export type BinaryenIdentity = {
    host: string;
    release: string;
    archive: string;
    archiveSha256: string;
    executable: string;
    executableSha256: string;
    version: string;
};
export type BinaryenRuntimeIdentity = BinaryenIdentity & { executablePath: string };
export type WasmBuildGeneration = {
    version: 1;
    packageId: string;
    head: string;
    sourceHash: string;
    inputsHash: string;
    command: string[];
    artifacts: Record<string, string>;
    optimizer: BinaryenIdentity;
};
const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
function object(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Invalid generation object');
    }
    return Object.fromEntries(Object.keys(value).map((key) => [key, Reflect.get(value, key)]));
}
function text(value: unknown): string {
    if (typeof value !== 'string' || !value || value.trim() !== value || /[\r\n\0]/.test(value)) {
        throw new Error('Invalid generation string');
    }
    return value;
}
function hash(value: unknown): string {
    const result = text(value);
    if (!/^[0-9a-f]{64}$/.test(result)) {
        throw new Error('Invalid SHA-256');
    }
    return result;
}
export function parseBinaryenIdentity(value: unknown): BinaryenIdentity {
    const data = object(value);
    const host = text(data.host);
    if ('executablePath' in data || 'optimizerPath' in data) {
        throw new Error('Public optimizer identity must not contain a private absolute path');
    }
    const pin = archivePins[host];
    const identity = {
        host,
        release: text(data.release),
        archive: text(data.archive),
        archiveSha256: hash(data.archiveSha256),
        executable: text(data.executable),
        executableSha256: hash(data.executableSha256),
        version: text(data.version),
    };
    if (
        !pin ||
        identity.release !== binaryenRelease ||
        identity.archive !== pin.archive ||
        identity.archiveSha256 !== pin.sha256 ||
        !/^wasm-opt version 133(?: \([^\r\n]*\))?$/.test(identity.version) ||
        identity.executable !== `binaryen-version_133/bin/wasm-opt${host.startsWith('win32-') ? '.exe' : ''}`
    ) {
        throw new Error('Binaryen identity does not match official archive pin and runtime version');
    }
    return identity;
}
export function assertRecordedBinaryenIdentity(value: unknown): BinaryenIdentity {
    const identity = parseBinaryenIdentity(value);
    const expected = binaryenExecutablePins[identity.host];
    if (!expected || expected !== identity.executableSha256) {
        throw new Error(`Missing or mismatched qualified Binaryen executable pin: ${identity.host}`);
    }
    return identity;
}
export function parseBuildGeneration(value: unknown): WasmBuildGeneration {
    const data = object(value);
    const head = text(data.head);
    const sourceHash = text(data.sourceHash);
    const inputsHash = text(data.inputsHash);
    if (!/^sha256:[a-f0-9]{64}$/.test(inputsHash)) {
        throw new Error('Invalid build inputs hash');
    }
    if (
        data.version !== 1 ||
        !/^[a-f0-9]{40}$/.test(head) ||
        !/^sha256:[a-f0-9]{64}$/.test(sourceHash) ||
        !Array.isArray(data.command)
    ) {
        throw new Error('Invalid build generation');
    }
    const artifacts = Object.fromEntries(
        Object.entries(object(data.artifacts)).map(([path, value]) => {
            if (!/^sha256:[a-f0-9]{64}$/.test(text(value))) {
                throw new Error('Invalid artifact hash');
            }
            return [path, text(value)];
        })
    );
    return {
        version: 1,
        packageId: text(data.packageId),
        head,
        sourceHash,
        inputsHash,
        command: data.command.map(text),
        artifacts,
        optimizer: parseBinaryenIdentity(data.optimizer),
    };
}
/** Refuse every symlink ancestor before reading/writing an owned cache or executing its binary. */
function assertRealPath(path: string): void {
    const absolute = resolve(path);
    let current = parse(absolute).root;
    for (const component of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
        current = join(current, component);
        if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
            throw new Error(`Refusing symlink path: ${current}`);
        }
    }
}
function assertOwnedFile(path: string): void {
    assertRealPath(path);
    const stat = lstatSync(path);
    if (
        !stat.isFile() ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
        (process.platform !== 'win32' && (stat.mode & 0o022) !== 0)
    ) {
        throw new Error('Binaryen cache file must be owned, regular and protected from group/other writes');
    }
}
function privateDirectory(path: string): string {
    assertRealPath(path);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    assertRealPath(path);
    const stat = lstatSync(path);
    if (
        !stat.isDirectory() ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
        (process.platform !== 'win32' && (stat.mode & 0o022) !== 0)
    ) {
        throw new Error('Cache target must be an owned directory without group/other write access');
    }
    return path;
}
export function assertArchiveDigest(bytes: Buffer, expected: string): void {
    if (digest(bytes) !== expected) {
        throw new Error('Binaryen archive checksum mismatch');
    }
}
export function assertArchiveEntries(names: readonly string[], details: readonly string[]): void {
    if (names.length === 0 || details.length !== names.length) {
        throw new Error('Invalid archive listing');
    }
    for (const name of names) {
        const parts = name.replace(/\/$/, '').split('/');
        if (
            parts[0] !== 'binaryen-version_133' ||
            parts.some((part) => !/^[A-Za-z0-9_.+-]+$/.test(part) || part === '.' || part === '..')
        ) {
            throw new Error(`Unsafe Binaryen archive path: ${name}`);
        }
    }
    if (details.some((line) => line[0] !== '-' && line[0] !== 'd')) {
        throw new Error('Archive may contain only regular files and directories');
    }
}
export function assertBinaryenIdentity(
    identity: BinaryenRuntimeIdentity,
    capture: (path: string, args: string[]) => string = (path, args) =>
        execFileSync(path, args, { encoding: 'utf8', env: wasmGenerationEnvironment() }).trim()
): BinaryenRuntimeIdentity {
    const { executablePath, ...published } = identity;
    parseBinaryenIdentity(published);
    assertOwnedFile(executablePath);
    if (
        !lstatSync(identity.executablePath).isFile() ||
        digest(readFileSync(identity.executablePath)) !== identity.executableSha256
    ) {
        throw new Error('Binaryen executable bytes differ from verified archive');
    }
    if (capture(identity.executablePath, ['--version']).trim() !== identity.version) {
        throw new Error('Binaryen runtime version differs from pin');
    }
    if (digest(readFileSync(identity.executablePath)) !== identity.executableSha256) {
        throw new Error('Binaryen executable bytes changed during version check');
    }
    return identity;
}
export async function readBoundedArchive(
    response: Response,
    size: number,
    expectedSha256: string,
    signal: AbortSignal
): Promise<Buffer> {
    if (!response.ok || !response.body) {
        throw new Error(`Binaryen archive download failed: HTTP ${response.status}`);
    }
    const declared = response.headers.get('content-length');
    if (declared !== null && declared !== String(size)) {
        throw new Error('Binaryen archive response length differs from official asset size');
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    const hash = createHash('sha256');
    let length = 0;
    const cancel = () => {
        void reader.cancel(signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        while (true) {
            signal.throwIfAborted();
            const next = await reader.read();
            signal.throwIfAborted();
            if (next.done) {
                break;
            }
            length += next.value.byteLength;
            if (length > size) {
                throw new Error('Binaryen archive response exceeds official asset size');
            }
            const chunk = Buffer.from(next.value);
            hash.update(chunk);
            chunks.push(chunk);
        }
        if (length !== size) {
            throw new Error('Binaryen archive response is shorter than official asset size');
        }
        if (hash.digest('hex') !== expectedSha256) {
            throw new Error('Binaryen archive checksum mismatch');
        }
        return Buffer.concat(chunks, length);
    } finally {
        signal.removeEventListener('abort', cancel);
        await reader.cancel();
        reader.releaseLock();
    }
}
function collision(error: unknown): boolean {
    return error instanceof Error && 'code' in error && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY');
}
/** Qualification authenticates foreign executable bytes without executing them. */
export async function qualifyBinaryenArchive(
    host: string
): Promise<Omit<BinaryenIdentity, 'version'> & { executablePath: string }> {
    const pin = archivePins[host];
    if (!pin) {
        throw new Error(`Unsupported Binaryen host: ${host}`);
    }
    const cache = privateDirectory(join(homedir(), '.cache', 'sourdaw', 'binaryen', binaryenRelease, host));
    const archivePath = join(cache, pin.archive);
    assertRealPath(archivePath);
    if (!existsSync(archivePath)) {
        const signal = AbortSignal.timeout(120_000);
        const response = await fetch(
            `https://github.com/WebAssembly/binaryen/releases/download/${binaryenRelease}/${pin.archive}`,
            { signal }
        );
        const bytes = await readBoundedArchive(response, pin.size, pin.sha256, signal);
        const partial = mkdtempSync(join(cache, 'download-'));
        const temporary = join(partial, pin.archive);
        try {
            writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
            try {
                linkSync(temporary, archivePath);
            } catch (error) {
                if (!collision(error)) {
                    throw error;
                }
            }
        } finally {
            rmSync(partial, { recursive: true, force: true });
        }
    }
    assertOwnedFile(archivePath);
    if (!lstatSync(archivePath).isFile() || lstatSync(archivePath).size !== pin.size) {
        throw new Error('Binaryen archive is not a regular file of official size');
    }
    assertArchiveDigest(readFileSync(archivePath), pin.sha256);
    const listing = (args: string[]) =>
        execFileSync('tar', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: wasmGenerationEnvironment() })
            .trimEnd()
            .split('\n');
    assertArchiveEntries(listing(['-tzf', archivePath]), listing(['-tvzf', archivePath]));
    const extracted = join(cache, 'verified');
    assertRealPath(extracted);
    if (!existsSync(extracted)) {
        const staging = mkdtempSync(join(cache, 'partial-'));
        try {
            execFileSync('tar', ['-xzf', archivePath, '-C', staging], {
                stdio: 'pipe',
                env: wasmGenerationEnvironment(),
            });
            try {
                renameSync(staging, extracted);
            } catch (error) {
                if (!collision(error)) {
                    throw error;
                }
            }
        } finally {
            rmSync(staging, { recursive: true, force: true });
        }
    }
    privateDirectory(extracted);
    const member = `binaryen-version_133/bin/wasm-opt${host.startsWith('win32-') ? '.exe' : ''}`;
    const executablePath = join(extracted, member);
    const archiveExecutable = execFileSync('tar', ['-xOzf', archivePath, member], {
        maxBuffer: 128 * 1024 * 1024,
        env: wasmGenerationEnvironment(),
    });
    assertRealPath(executablePath);
    if (!lstatSync(executablePath).isFile() || digest(readFileSync(executablePath)) !== digest(archiveExecutable)) {
        throw new Error('Binaryen executable bytes differ from verified archive');
    }
    return {
        host,
        release: binaryenRelease,
        archive: pin.archive,
        archiveSha256: pin.sha256,
        executable: member,
        executablePath,
        executableSha256: digest(archiveExecutable),
    };
}
/** macOS wasm-opt loads this archive's sibling dylib; hashing only the launcher is insufficient. */
export function assertRuntimeArchiveBindings(
    identity: Pick<BinaryenRuntimeIdentity, 'host' | 'archive' | 'archiveSha256' | 'executablePath'>
): void {
    if (!identity.host.startsWith('darwin-')) {
        return;
    }
    const archivePath = join(
        homedir(),
        '.cache',
        'sourdaw',
        'binaryen',
        binaryenRelease,
        identity.host,
        identity.archive
    );
    assertRealPath(archivePath);
    assertArchiveDigest(readFileSync(archivePath), identity.archiveSha256);
    const member = 'binaryen-version_133/lib/libbinaryen.dylib';
    const expected = execFileSync('tar', ['-xOzf', archivePath, member], {
        maxBuffer: 128 * 1024 * 1024,
        env: wasmGenerationEnvironment(),
    });
    const libraryPath = join(dirname(dirname(identity.executablePath)), 'lib', 'libbinaryen.dylib');
    assertOwnedFile(libraryPath);
    if (!lstatSync(libraryPath).isFile() || digest(readFileSync(libraryPath)) !== digest(expected)) {
        throw new Error('Binaryen runtime library bytes differ from verified archive');
    }
}
export async function provisionBinaryen(): Promise<BinaryenRuntimeIdentity> {
    const qualified = await qualifyBinaryenArchive(`${process.platform}-${process.arch}`);
    assertRuntimeArchiveBindings(qualified);
    const version = execFileSync(qualified.executablePath, ['--version'], {
        encoding: 'utf8',
        env: wasmGenerationEnvironment(),
    }).trim();
    return assertBinaryenIdentity({ ...qualified, version });
}
function receiptDirectory(root: string): string {
    return privateDirectory(join(homedir(), '.cache', 'sourdaw', 'wasm-build-receipts', digest(realpathSync(root))));
}
export function sameArtifactHashes(left: Record<string, string>, right: Record<string, string>): boolean {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}
export function validateBuildReceipt(
    value: unknown,
    expected: {
        head: string;
        sourceHash: string;
        inputsHash: string;
        command: string[];
        artifacts: Record<string, string>;
    }
): WasmBuildGeneration {
    const generation = parseBuildGeneration(value);
    if (
        generation.head !== expected.head ||
        generation.sourceHash !== expected.sourceHash ||
        generation.inputsHash !== expected.inputsHash ||
        JSON.stringify(generation.command) !== JSON.stringify(expected.command) ||
        !sameArtifactHashes(generation.artifacts, expected.artifacts)
    ) {
        throw new Error('Build receipt head, command, source or output mismatch');
    }
    return generation;
}
export function readBuildReceipt(
    root: string,
    packageId: string,
    expected: {
        head: string;
        sourceHash: string;
        inputsHash: string;
        command: string[];
        artifacts: Record<string, string>;
    }
): WasmBuildGeneration {
    const directory = receiptDirectory(root);
    const path = join(directory, `${packageId}.json`);
    assertRealPath(path);
    const localReceipt = object(JSON.parse(readFileSync(path, 'utf8')));
    const optimizerPath = text(localReceipt.optimizerPath);
    if (!isAbsolute(optimizerPath)) {
        throw new Error('Local optimizer path must be absolute');
    }
    const generation = validateBuildReceipt(localReceipt, expected);
    if (generation.packageId !== packageId) {
        throw new Error('Receipt belongs to another WASM package');
    }
    const identity = generation.optimizer;
    const archivePath = join(
        homedir(),
        '.cache',
        'sourdaw',
        'binaryen',
        binaryenRelease,
        identity.host,
        identity.archive
    );
    assertRealPath(archivePath);
    assertArchiveDigest(readFileSync(archivePath), identity.archiveSha256);
    const member = `binaryen-version_133/bin/wasm-opt${identity.host.startsWith('win32-') ? '.exe' : ''}`;
    const archiveExecutable = execFileSync('tar', ['-xOzf', archivePath, member], {
        maxBuffer: 128 * 1024 * 1024,
        env: wasmGenerationEnvironment(),
    });
    if (digest(archiveExecutable) !== identity.executableSha256) {
        throw new Error('Receipt optimizer bytes are not authenticated by the pinned archive');
    }
    assertRuntimeArchiveBindings({ ...identity, executablePath: optimizerPath });
    assertBinaryenIdentity({ ...identity, executablePath: optimizerPath });
    return generation;
}
export function buildCommand(packageId: string): string[] {
    if (!['daw-dsp', 'proof-chamber', 'scoring', 'daw-wasm-decoder'].includes(packageId)) {
        throw new Error('Unknown WASM build package');
    }
    const args = ['build', '--target', 'web', '--out-dir', `../../public/wasm/${packageId}`];
    if (packageId === 'daw-wasm-decoder') {
        args.push('--no-typescript');
    }
    return args;
}
export function currentHead(root: string): string {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        env: wasmGenerationEnvironment(),
    }).trim();
    if (!/^[a-f0-9]{40}$/.test(head)) {
        throw new Error('Invalid build source head');
    }
    return head;
}
function packageBuildScript(packageId: string): string {
    const scripts: Readonly<Record<string, string>> = {
        'daw-dsp': 'wasm:dsp',
        'proof-chamber': 'wasm:proof-chamber',
        scoring: 'wasm:scoring',
        'daw-wasm-decoder': 'wasm:decoder',
    };
    const script = scripts[packageId];
    if (script === undefined) {
        throw new Error(`Unknown WASM build package: ${packageId}`);
    }
    return script;
}
/** Explicit producer closure; the spec compares it to the actual local import graph for all four routes. */
function generationControlPaths(packageId: string): string[] {
    packageBuildScript(packageId);
    const files = [
        'scripts/binaryenBuild.ts',
        'scripts/buildWasmPackage.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/workspaceManifestFingerprint.ts',
        'scripts/markWasmPackageInternal.ts',
        'scripts/strictJson.ts',
        'scripts/pnpmLock.ts',
        'scripts/gen-wasm-manifest.ts',
    ];
    if (packageId !== 'daw-wasm-decoder') {
        files.push(`scripts/gen-${packageId}-worklet.ts`, 'scripts/workletPolyfills.ts');
    }
    return files.sort();
}
function canonicalInput(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalInput).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const fields = object(value);
        return `{${Object.keys(fields)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalInput(fields[key])}`)
            .join(',')}}`;
    }
    if (value === undefined) {
        throw new Error('Generation input must not be undefined');
    }
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
        throw new Error('Generation input must be JSON-compatible');
    }
    return encoded;
}
/** yaml is the marker/parser's only non-stdlib producer dependency; refuse an unmodelled runtime graph. */
function generationYamlIdentity(root: string, manifest: Record<string, unknown>): unknown {
    const lock = parsePnpmLock(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'), root);
    const importer = lock.application.importers?.['.'];
    const sections = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
    const rows = sections.flatMap((section) => {
        const row = importer?.[section]?.yaml;
        if (row === undefined) {
            return [];
        }
        const declared = object(manifest[section]).yaml;
        if (typeof declared !== 'string' || declared !== row.specifier) {
            throw new Error('Selected yaml dependency differs from the generation lock');
        }
        return [row];
    });
    const selected = rows[0];
    if (rows.length !== 1 || selected?.version === undefined || selected.specifier === undefined) {
        throw new Error('Expected one locked yaml generation dependency');
    }
    const key = `yaml@${selected.version}`;
    const archive = lock.application.packages[key];
    if (typeof archive?.resolution?.integrity !== 'string') {
        throw new Error('Locked yaml generation archive has no integrity');
    }
    const snapshot = object(object(lock.application.snapshots)[key]);
    if (snapshot.dependencies !== undefined || snapshot.optionalDependencies !== undefined) {
        throw new Error('yaml generation runtime dependencies require an explicit closure update');
    }
    return { selected, archive, snapshot };
}
/** Cargo compilation inputs are separately bound by crate sourceHash; unrelated manifests/lock rows stay irrelevant. */
export function generationInputsHash(root: string, packageId: string): string {
    const manifest = object(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    const scripts = object(manifest.scripts);
    const script = packageBuildScript(packageId);
    const metadata = {
        node: readFileSync(join(root, '.node-version'), 'utf8').trim(),
        nodeEngine: text(object(manifest.engines).node),
        moduleType: text(manifest.type),
        packageManager: text(manifest.packageManager),
        scripts: { [script]: text(scripts[script]), 'wasm:manifest': text(scripts['wasm:manifest']) },
        argv: buildCommand(packageId),
        yaml: generationYamlIdentity(root, manifest),
    };
    const files = [...generationControlPaths(packageId), '.cargo/config.toml', 'rust-toolchain.toml'].sort();
    const input = files.map((path) => `${path}\0${digest(readFileSync(join(root, path)))}`).join('\n');
    return `sha256:${digest(`${canonicalInput(metadata)}\n${input}`)}`;
}
function assertGeneratedOnlyChanges(root: string, allowed: readonly string[]): void {
    const capture = (args: string[]) =>
        execFileSync('git', args, { cwd: root, encoding: 'utf8', env: wasmGenerationEnvironment() });
    const dirty = [
        capture(['diff', '--name-only', '-z', 'HEAD']),
        capture(['ls-files', '--others', '--exclude-standard', '-z']),
    ].flatMap((text) => text.split('\0').filter(Boolean));
    const unexpected = dirty.filter((path) => !allowed.includes(path));
    if (unexpected.length > 0) {
        throw new Error(`WASM build requires committed source inputs: ${unexpected.join(', ')}`);
    }
}
/** Only this helper issues a receipt, after the actual child and finalizers succeed. */
export async function runVerifiedWasmBuild(input: {
    root: string;
    packageId: string;
    crateDir: string;
    allowedGeneratedPaths: readonly string[];
    sourceHash: () => string;
    artifacts: () => Record<string, string>;
    finalize: () => void;
}): Promise<void> {
    const command = buildCommand(input.packageId);
    const directory = receiptDirectory(input.root);
    const path = join(directory, `${input.packageId}.json`);
    assertRealPath(path);
    // A failed new attempt cannot leave an earlier success receipt eligible for restamping.
    rmSync(path, { force: true });
    assertGeneratedOnlyChanges(input.root, input.allowedGeneratedPaths);
    const head = currentHead(input.root);
    const sourceHash = input.sourceHash();
    const inputsHash = generationInputsHash(input.root, input.packageId);
    const optimizer = await provisionBinaryen();
    const env = {
        ...wasmGenerationEnvironment(),
        PATH: `${dirname(optimizer.executablePath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    };
    const wasmPack = execFileSync('wasm-pack', ['--version'], { cwd: input.root, env, encoding: 'utf8' }).trim();
    if (wasmPack !== `wasm-pack ${wasmToolchainPins.wasmPack}`) {
        throw new Error('Installed wasm-pack differs from build pin');
    }
    assertRuntimeArchiveBindings(optimizer);
    assertBinaryenIdentity(optimizer);
    execFileSync('wasm-pack', command, { cwd: join(input.root, input.crateDir), env, stdio: 'inherit' });
    assertBinaryenIdentity(optimizer);
    assertRuntimeArchiveBindings(optimizer);
    if (
        currentHead(input.root) !== head ||
        input.sourceHash() !== sourceHash ||
        generationInputsHash(input.root, input.packageId) !== inputsHash
    ) {
        throw new Error('WASM source changed during build');
    }
    input.finalize();
    if (
        currentHead(input.root) !== head ||
        input.sourceHash() !== sourceHash ||
        generationInputsHash(input.root, input.packageId) !== inputsHash
    ) {
        throw new Error('WASM source changed during finalization');
    }
    assertGeneratedOnlyChanges(input.root, input.allowedGeneratedPaths);
    const { executablePath: optimizerPath, ...publicOptimizer } = optimizer;
    const generation: WasmBuildGeneration = {
        version: 1,
        packageId: input.packageId,
        head,
        sourceHash,
        inputsHash,
        command,
        artifacts: input.artifacts(),
        optimizer: publicOptimizer,
    };
    assertRealPath(path);
    writeFileSync(path, `${JSON.stringify({ ...generation, optimizerPath })}\n`, { flag: 'wx', mode: 0o600 });
}

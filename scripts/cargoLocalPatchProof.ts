/** Authenticate an explicitly registered local Cargo source capsule offline. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    lstatSync,
    openSync,
    closeSync,
    fstatSync,
    readSync,
    constants,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Parser as TarParser } from 'tar';
import { parseJsonWithUniqueKeys } from './strictJson.ts';
import { tomlTableLines } from './workspaceManifestFingerprint.ts';

export type CapsuleRecord = {
    package: string;
    version: string;
    directory: string;
    license: string;
    upstreamArchive: string;
    upstreamArchiveSha256: string;
    patch: string;
    patchSha256: string;
    patchContentSha256: string;
    licensePaths: string[];
    changedFiles: Array<{ path: string; original_sha256: string | null; patched_sha256: string | null }>;
};
export type SourceManifest = { schemaVersion: 1; sources: CapsuleRecord[] };
type ArchiveFile = { bytes: Buffer; executable: boolean };
export type CargoLocalPatch = {
    kind: 'local-patch';
    directory: string;
    archivePath: string;
    upstreamArchive: string;
    upstreamArchiveSha256: string;
    patchPath: string;
    patchSha256: string;
    patchContentSha256: string;
    sourceTreeSha256: string;
    legalFiles: Array<{ path: string; originalSha256: string; sourceSha256: string }>;
};
export type LocalLegalFile = { label: string; sha256: string; contents: string };
const SOURCE_LIMIT = 256 * 1024 * 1024;
const COMPRESSED_LIMIT = 64 * 1024 * 1024;
const RECIPE_LIMIT = 32 * 1024 * 1024;
const ENTRY_LIMIT = 50_000;
function readBounded(path: string, limit: number): Buffer {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > limit)
            throw new Error('Local patch input exceeds its regular-file size bound');
        const chunks: Buffer[] = [];
        let length = 0;
        while (length <= limit) {
            const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - length));
            const count = readSync(fd, chunk, 0, chunk.length, null);
            if (count === 0) return Buffer.concat(chunks, length);
            length += count;
            if (length > limit) throw new Error('Local patch input exceeds its regular-file size bound');
            chunks.push(chunk.subarray(0, count));
        }
        throw new Error('Local patch input exceeds its regular-file size bound');
    } finally {
        closeSync(fd);
    }
}
const SOURCE_MANIFEST = 'vendor/rust/sources.json';
const LEGAL_FILE = /^(?:licen[cs]e|notice|copying|copyright)(?:[._-].*)?$/iu;
const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const outside = (path: string): boolean => path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
function canonical(path: string): void {
    if (
        !path ||
        path === '.' ||
        path !== posix.normalize(path) ||
        path.includes('\\') ||
        /[\u0000-\u001f\u007f]/u.test(path) ||
        posix.isAbsolute(path) ||
        path.split('/').includes('..')
    )
        throw new Error(`Noncanonical local patch path: ${path}`);
}
function fenced(root: string, fence: string, path: string): string {
    canonical(path);
    const target = resolve(fence, path);
    if (outside(relative(fence, target)) || outside(relative(root, target)))
        throw new Error(`Local patch path escapes its source fence: ${path}`);
    let current = root;
    for (const part of relative(root, target).split(sep)) {
        current = join(current, part);
        if (lstatSync(current).isSymbolicLink())
            throw new Error(`Local patch source symlink is unsupported: ${current}`);
    }
    return target;
}
function withoutAsciiTrailingSpace(bytes: Buffer): Buffer {
    let end = bytes.length;
    while (end > 0 && [9, 10, 13, 32].includes(bytes[end - 1]!)) end -= 1;
    return bytes.subarray(0, end);
}
function packageFields(text: string): { name: string; version: string; license: string } {
    const fields = new Map<string, string>();
    for (const { header, line } of tomlTableLines(text)) {
        if (header !== 'package') continue;
        const match = /^(name|version|license)\s*=\s*"([^"\\]+)"$/u.exec(line);
        if (match?.[1] && match[2]) {
            if (fields.has(match[1])) throw new Error('Repeated local patch package identity');
            fields.set(match[1], match[2]);
        }
    }
    const name = fields.get('name');
    const version = fields.get('version');
    const license = fields.get('license');
    if (!name || !version || !license) throw new Error('Incomplete local patch package identity or license');
    return { name, version, license };
}
function registeredCapsule(root: string, name: string, version: string): CapsuleRecord {
    const manifest = parseJsonWithUniqueKeys<SourceManifest>(
        readBounded(fenced(root, root, SOURCE_MANIFEST), 8 * 1024 * 1024).toString('utf8'),
        SOURCE_MANIFEST
    );
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources))
        throw new Error('Unsupported local patch source manifest');
    const patches = new Map<string, string>();
    for (const { header, line } of tomlTableLines(
        readBounded(fenced(root, root, 'Cargo.toml'), 8 * 1024 * 1024).toString('utf8')
    )) {
        if (!header.startsWith('patch')) continue;
        const match = /^([\w-]+)\s*=\s*\{\s*path\s*=\s*"([^"\\]+)"\s*\}$/u.exec(line);
        if (header !== 'patch.crates-io' || !match?.[1] || !match[2] || patches.has(match[1]))
            throw new Error(`Unsupported or ambiguous local patch binding: ${line}`);
        patches.set(match[1], match[2]);
    }
    if (patches.size !== manifest.sources.length)
        throw new Error('Local source manifest does not cover the complete root patch table');
    const identities = new Set<string>();
    for (const record of manifest.sources) {
        if (!record.directory.startsWith('vendor/rust/') || patches.get(record.package) !== record.directory)
            throw new Error(`Unregistered local patch source: ${record.package}`);
        const actual = packageFields(
            readBounded(fenced(root, fenced(root, root, record.directory), 'Cargo.toml'), 1024 * 1024).toString('utf8')
        );
        const key = `${record.package}@${record.version}`;
        if (
            actual.name !== record.package ||
            actual.version !== record.version ||
            actual.license !== record.license ||
            identities.has(key)
        )
            throw new Error(`Ambiguous or drifted local patch identity: ${key}`);
        identities.add(key);
    }
    const matches = manifest.sources.filter((record) => record.package === name && record.version === version);
    const record = matches[0];
    if (matches.length !== 1 || !record) throw new Error(`Missing local patch identity: ${name}@${version}`);
    for (const hash of [record.upstreamArchiveSha256, record.patchSha256, record.patchContentSha256])
        if (!/^[0-9a-f]{64}$/u.test(hash)) throw new Error('Invalid local patch source digest');
    const canonicalArchive = `https://static.crates.io/crates/${name}/${name}-${version}.crate`;
    if (record.upstreamArchive !== canonicalArchive) throw new Error('Local patch original archive identity drifted');
    const blocks = readBounded(fenced(root, root, 'Cargo.lock'), 32 * 1024 * 1024)
        .toString('utf8')
        .split('[[package]]')
        .slice(1);
    const local = blocks.filter((block) => {
        const fields = new Map(
            [...block.matchAll(/^(name|version|source|checksum) = "([^"]+)"$/gmu)].map((match) => [match[1], match[2]])
        );
        return (
            fields.get('name') === name &&
            fields.get('version') === version &&
            !fields.has('source') &&
            !fields.has('checksum')
        );
    });
    if (local.length !== 1) throw new Error('Local patch is not a unique path-resolved Cargo.lock package');
    return record;
}
function archiveFiles(archive: Buffer, prefix: string): Map<string, ArchiveFile> {
    // Decompress before parsing so headers, metadata and skipped entries share one hard bound.
    const decoded = gunzipSync(archive, { maxOutputLength: SOURCE_LIMIT });
    const files = new Map<string, ArchiveFile>();
    const seen = new Set<string>();
    let failure: Error | undefined;
    let total = 0;
    const parser = new TarParser({
        strict: true,
        maxMetaEntrySize: 1024 * 1024,
        onReadEntry(entry) {
            try {
                if (
                    typeof entry.mode !== 'number' ||
                    !Number.isSafeInteger(entry.mode) ||
                    entry.mode < 0 ||
                    entry.mode > 0o777
                )
                    throw new Error('Original archive member has an unsupported permission mode');
                const member = entry.path.endsWith('/') ? entry.path.slice(0, -1) : entry.path;
                canonical(member);
                if (
                    (!member.startsWith(`${prefix}/`) && member !== prefix) ||
                    seen.has(member) ||
                    seen.size >= ENTRY_LIMIT
                )
                    throw new Error('Invalid, repeated or excessive original archive member');
                seen.add(member);
                if (entry.type === 'Directory') {
                    entry.resume();
                    return;
                }
                if (member === prefix || !['File', 'OldFile', 'ContiguousFile'].includes(entry.type))
                    throw new Error('Original archive member is not a regular source file');
                const path = member.slice(prefix.length + 1);
                canonical(path);
                total += entry.size;
                if (!Number.isSafeInteger(entry.size) || entry.size < 0 || total > SOURCE_LIMIT)
                    throw new Error('Original source capsule exceeds reviewed archive size bound');
                const executable = (entry.mode & 0o111) !== 0;
                const chunks: Buffer[] = [];
                entry.on('data', (chunk: Buffer) => chunks.push(chunk));
                entry.on('end', () => {
                    const bytes = Buffer.concat(chunks);
                    if (bytes.length !== entry.size) failure = new Error('Original archive member body is truncated');
                    files.set(path, { bytes, executable });
                });
                entry.resume();
            } catch (cause) {
                failure = cause instanceof Error ? cause : new Error(String(cause));
                entry.resume();
            }
        },
    });
    parser.on('ignoredEntry', () => {
        failure = new Error('Original archive contains an unsupported or ignored member');
    });
    parser.on('error', (error: Error) => {
        failure = error;
    });
    parser.end(decoded);
    if (failure) throw failure;
    if (!files.has('Cargo.toml')) throw new Error('Original source capsule has no package manifest');
    return files;
}
function tree(root: string, directory: string): Map<string, ArchiveFile> {
    const files = new Map<string, ArchiveFile>();
    let total = 0;
    let entries = 0;
    function visit(path: string): void {
        if (++entries > ENTRY_LIMIT) throw new Error('Local source capsule exceeds its entry count bound');
        const target = fenced(root, directory, path);
        const stat = lstatSync(target);
        if (stat.isDirectory()) {
            for (const child of readdirSync(target)) visit(posix.join(path, child));
        } else if (stat.isFile()) {
            total += stat.size;
            if (total > SOURCE_LIMIT) throw new Error('Local source capsule exceeds its size bound');
            files.set(path, { bytes: readBounded(target, SOURCE_LIMIT), executable: (stat.mode & 0o111) !== 0 });
        } else throw new Error(`Unsupported local source capsule input: ${path}`);
    }
    for (const path of readdirSync(directory)) visit(path);
    return files;
}
function treeDigest(files: ReadonlyMap<string, ArchiveFile>): string {
    const hash = createHash('sha256');
    for (const [path, file] of [...files].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
        hash.update(`${path}\0${file.executable ? 'x' : '-'}\0${digest(file.bytes)}\n`);
    return hash.digest('hex');
}
/** No Cargo, registry access or package scripts: original archive + exact patch + actual source bytes. */
export function inspectCargoLocalPatch(
    rootPath: string,
    pkg: { name: string; version: string; manifestPath?: string },
    expected?: CargoLocalPatch
): { provenance: CargoLocalPatch; legalFiles: LocalLegalFile[]; license: string } {
    const root = realpathSync(rootPath);
    const record = registeredCapsule(root, pkg.name, pkg.version);
    const directory = fenced(root, root, record.directory);
    if (pkg.manifestPath !== undefined && resolve(pkg.manifestPath) !== fenced(root, directory, 'Cargo.toml'))
        throw new Error('Cargo metadata local patch manifest path drifted');
    const archivePath = `release/dependency-license-proofs/${pkg.name}-${pkg.version}.crate`;
    const archive = fenced(root, root, archivePath);
    const archiveBytes = readBounded(archive, COMPRESSED_LIMIT);
    if (digest(archiveBytes) !== record.upstreamArchiveSha256)
        throw new Error('Local patch original archive checksum drifted');
    const original = archiveFiles(archiveBytes, `${pkg.name}-${pkg.version}`);
    const fields = packageFields(original.get('Cargo.toml')!.bytes.toString('utf8'));
    if (fields.name !== pkg.name || fields.version !== pkg.version || fields.license !== record.license)
        throw new Error('Local patch original package identity or license drifted');
    canonical(record.patch);
    if (!record.patch.startsWith('patches/') || !record.patch.endsWith('.patch.gz'))
        throw new Error('Local patch recipe is outside the maintained patch capsule');
    const patchPath = posix.join('vendor/rust', record.patch);
    const patch = readBounded(fenced(root, root, patchPath), RECIPE_LIMIT);
    if (digest(patch) !== record.patchSha256) throw new Error('Local patch compressed patch checksum drifted');
    const decoded = gunzipSync(patch, { maxOutputLength: RECIPE_LIMIT });
    if (digest(decoded) !== record.patchContentSha256) throw new Error('Local patch decoded patch checksum drifted');
    const changes = new Map(record.changedFiles.map((change) => [change.path, change]));
    if (changes.size !== record.changedFiles.length || changes.size === 0)
        throw new Error('Local patch changed-file identities are empty or ambiguous');
    for (const change of changes.values()) {
        canonical(change.path);
        const before = original.get(change.path);
        if ((before ? digest(before.bytes) : null) !== change.original_sha256)
            throw new Error(`Local patch original file binding drifted: ${change.path}`);
    }
    const scratch = mkdtempSync(join(tmpdir(), 'sourdaw-local-cargo-proof-'));
    const expectedFiles = new Map(original);
    try {
        const work = join(scratch, 'tree');
        mkdirSync(work);
        for (const path of changes.keys()) {
            const before = original.get(path);
            if (!before) continue;
            const target = resolve(work, path);
            if (outside(relative(work, target))) throw new Error('Local patch recipe escapes scratch source tree');
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, before.bytes, { mode: before.executable ? 0o755 : 0o644 });
        }
        const recipe = join(scratch, 'source.patch');
        writeFileSync(recipe, decoded);
        const gitConfig = join(scratch, 'empty.gitconfig');
        writeFileSync(gitConfig, '');
        // Guard scratch can live beneath a repository. Stop discovery so Git-format recipes
        // are applied relative to this private tree instead of silently skipped by a repository prefix.
        execFileSync(
            'git',
            [
                '-c',
                'core.autocrlf=false',
                'apply',
                '--no-index',
                '--unidiff-zero',
                '--whitespace=error-all',
                '--',
                recipe,
            ],
            {
                cwd: work,
                stdio: 'pipe',
                timeout: 30_000,
                maxBuffer: 1024 * 1024,
                env: {
                    PATH: process.env.PATH,
                    GIT_CONFIG_NOSYSTEM: '1',
                    GIT_CONFIG_GLOBAL: gitConfig,
                    GIT_CONFIG_COUNT: '0',
                    GIT_CEILING_DIRECTORIES: scratch,
                },
            }
        );
        const patched = tree(scratch, work);
        for (const path of patched.keys())
            if (!changes.has(path)) throw new Error(`Local patch recipe modifies an unrecorded input: ${path}`);
        for (const change of changes.values()) {
            const after = patched.get(change.path);
            if ((after ? digest(after.bytes) : null) !== change.patched_sha256)
                throw new Error(`Local patch recipe output drifted: ${change.path}`);
            if (after) expectedFiles.set(change.path, after);
            else expectedFiles.delete(change.path);
        }
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
    const actual = tree(root, directory);
    if (
        actual.size !== expectedFiles.size ||
        [...expectedFiles].some(([path, file]) => {
            const found = actual.get(path);
            return !found || found.executable !== file.executable || !found.bytes.equals(file.bytes);
        })
    )
        throw new Error('Local modified source capsule bytes drifted from original archive plus recorded patch');
    const legalPaths = [...original.keys()].filter((path) => LEGAL_FILE.test(posix.basename(path))).sort();
    if (JSON.stringify([...record.licensePaths].sort()) !== JSON.stringify(legalPaths))
        throw new Error('Local patch original legal-file set drifted');
    const legalFiles = legalPaths.map((path) => {
        const before = original.get(path)!;
        const after = actual.get(path)!;
        if (
            !after ||
            (!before.bytes.equals(after.bytes) &&
                (pkg.name !== 'reqwest' ||
                    !withoutAsciiTrailingSpace(before.bytes).equals(withoutAsciiTrailingSpace(after.bytes))))
        )
            throw new Error(`Local patch original legal wording drifted: ${path}`);
        return { path, originalSha256: digest(before.bytes), sourceSha256: digest(after.bytes) };
    });
    const provenance: CargoLocalPatch = {
        kind: 'local-patch',
        directory: record.directory,
        archivePath,
        upstreamArchive: record.upstreamArchive,
        upstreamArchiveSha256: record.upstreamArchiveSha256,
        patchPath,
        patchSha256: record.patchSha256,
        patchContentSha256: record.patchContentSha256,
        sourceTreeSha256: treeDigest(actual),
        legalFiles,
    };
    if (expected !== undefined && JSON.stringify(expected) !== JSON.stringify(provenance))
        throw new Error('Snapshot-bound local patch provenance drifted');
    return {
        provenance,
        license: record.license,
        legalFiles: legalFiles.map(({ path, sourceSha256 }) => ({
            label: `${record.directory}/${path}`,
            sha256: sourceSha256,
            contents: actual.get(path)!.bytes.toString('utf8'),
        })),
    };
}
export function localPatchDescription(patch: CargoLocalPatch | undefined): string {
    return patch === undefined
        ? ''
        : ` | locally modified ${patch.directory}; original archive sha256:${patch.upstreamArchiveSha256}; patch sha256:${patch.patchSha256}; source tree sha256:${patch.sourceTreeSha256}`;
}

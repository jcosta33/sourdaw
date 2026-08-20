import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEVAIN_SOURCE } from './levainSource.ts';

export type LevainProvenance = {
    schemaVersion: number;
    source: {
        repository: string;
        revision: string;
        tree: string;
        license: string;
        licensePath: string;
        licenseBlob: string;
    };
    samples: Array<{
        path: string;
        sourcePath: string;
        gitBlob: string;
        sha256: string;
        license: string;
    }>;
    generatedFiles: Array<{
        path: string;
        source: string;
        license: string;
        sha256: string;
    }>;
};

const provenancePath = 'public/samples/levain/provenance.tsv';
const sampleRoot = 'public/samples/levain';
const columns = ['kind', 'path', 'source', 'gitBlob', 'sha256', 'license'];

type UpstreamCommit = { sha: string; commit: { tree: { sha: string } } };
type UpstreamTree = { truncated: boolean; tree: Array<{ path: string; type: string; sha: string }> };

function sha256(contents: Buffer): string {
    return createHash('sha256').update(contents).digest('hex');
}

function gitBlob(contents: Buffer): string {
    return createHash('sha1')
        .update(`blob ${String(contents.length)}\0`)
        .update(contents)
        .digest('hex');
}

function entriesBelow(root: string, directory: string): { files: string[]; symlinks: string[] } {
    const entries = readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true });
    const pathFor = (entry: (typeof entries)[number]): string =>
        relative(root, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/');
    return {
        files: entries
            .filter((entry) => entry.isFile())
            .map(pathFor)
            .sort(),
        symlinks: entries
            .filter((entry) => entry.isSymbolicLink())
            .map(pathFor)
            .sort(),
    };
}

function duplicateValues(values: string[]): string[] {
    return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}

function validRelativePath(path: string): boolean {
    return path !== '' && !path.startsWith('/') && !path.split('/').includes('..');
}

export function parseLevainProvenance(contents: string): LevainProvenance {
    const lines = contents.trimEnd().split('\n');
    const metadata = new Map<string, string>();
    while (lines[0]?.startsWith('#\t')) {
        const [, key, value, ...extra] = lines.shift()!.split('\t');
        if (key === undefined || value === undefined || extra.length > 0 || metadata.has(key)) {
            throw new Error('Malformed Levain provenance metadata');
        }
        metadata.set(key, value);
    }
    if (lines.shift() !== columns.join('\t')) {
        throw new Error('Malformed Levain provenance columns');
    }

    const provenance: LevainProvenance = {
        schemaVersion: Number(metadata.get('schemaVersion')),
        source: {
            repository: metadata.get('repository') ?? '',
            revision: metadata.get('revision') ?? '',
            tree: metadata.get('tree') ?? '',
            license: metadata.get('license') ?? '',
            licensePath: metadata.get('licensePath') ?? '',
            licenseBlob: metadata.get('licenseBlob') ?? '',
        },
        samples: [],
        generatedFiles: [],
    };
    for (const line of lines) {
        const [kind, path, source, blob, fileSha256, license, ...extra] = line.split('\t');
        if (
            extra.length > 0 ||
            path === undefined ||
            source === undefined ||
            blob === undefined ||
            fileSha256 === undefined ||
            license === undefined
        ) {
            throw new Error(`Malformed Levain provenance row: ${line}`);
        }
        if (kind === 'sample') {
            provenance.samples.push({ path, sourcePath: source, gitBlob: blob, sha256: fileSha256, license });
        } else if (kind === 'generated') {
            provenance.generatedFiles.push({ path, source, license, sha256: fileSha256 });
        } else {
            throw new Error(`Unknown Levain provenance kind: ${String(kind)}`);
        }
    }
    return provenance;
}

export function validateLevainProvenance(root: string, provenance: LevainProvenance): string[] {
    const errors: string[] = [];
    if (provenance.schemaVersion !== 1) {
        errors.push('Levain provenance schemaVersion must be 1');
    }
    for (const key of ['repository', 'revision', 'tree', 'license', 'licensePath', 'licenseBlob'] as const) {
        if (provenance.source[key] !== LEVAIN_SOURCE[key]) {
            errors.push(`Levain source ${key} does not match the release pin`);
        }
    }

    const entries = [...provenance.samples, ...provenance.generatedFiles];
    const paths = entries.map((entry) => entry.path);
    const duplicates = duplicateValues(paths);
    if (duplicates.length > 0) {
        errors.push(`duplicate Levain provenance paths:\n${duplicates.join('\n')}`);
    }

    const discovered = entriesBelow(root, sampleRoot);
    if (discovered.symlinks.length > 0) {
        errors.push(`Levain symlinks are forbidden:\n${discovered.symlinks.join('\n')}`);
    }
    const actualPaths = discovered.files.filter((path) => path !== provenancePath);
    const missing = actualPaths.filter((path) => !paths.includes(path));
    const stale = paths.filter((path) => !actualPaths.includes(path));
    if (missing.length > 0) {
        errors.push(`unproven Levain files:\n${missing.join('\n')}`);
    }
    if (stale.length > 0) {
        errors.push(`stale Levain provenance paths:\n${stale.join('\n')}`);
    }

    for (const sample of provenance.samples) {
        if (!sample.path.startsWith(`${sampleRoot}/`) || !sample.path.endsWith('.wav')) {
            errors.push(`${sample.path}: sample path must be a Levain WAV`);
        }
        if (!validRelativePath(sample.sourcePath) || !sample.sourcePath.endsWith('.wav')) {
            errors.push(`${sample.path}: sourcePath must be a relative WAV path`);
        }
        if (sample.license !== LEVAIN_SOURCE.license) {
            errors.push(`${sample.path}: license must be ${LEVAIN_SOURCE.license}`);
        }
        if (!/^[0-9a-f]{40}$/.test(sample.gitBlob)) {
            errors.push(`${sample.path}: gitBlob must be a Git blob`);
        }
        if (!/^[0-9a-f]{64}$/.test(sample.sha256)) {
            errors.push(`${sample.path}: sha256 must be SHA-256`);
        }
        const absolutePath = resolve(root, sample.path);
        if (!existsSync(absolutePath)) {
            continue;
        }
        const contents = readFileSync(absolutePath);
        if (gitBlob(contents) !== sample.gitBlob) {
            errors.push(`${sample.path}: upstream blob drifted`);
        }
        if (sha256(contents) !== sample.sha256) {
            errors.push(`${sample.path}: SHA-256 drifted`);
        }
    }

    for (const generated of provenance.generatedFiles) {
        if (!generated.path.startsWith(`${sampleRoot}/`) || !generated.path.endsWith('/manifest.json')) {
            errors.push(`${generated.path}: generated path must be a Levain manifest`);
        }
        if (generated.license !== 'project-source') {
            errors.push(`${generated.path}: license must be project-source`);
        }
        if (!/^[0-9a-f]{64}$/.test(generated.sha256)) {
            errors.push(`${generated.path}: sha256 must be SHA-256`);
        }
        const absolutePath = resolve(root, generated.path);
        if (existsSync(absolutePath) && sha256(readFileSync(absolutePath)) !== generated.sha256) {
            errors.push(`${generated.path}: SHA-256 drifted`);
        }
        const sourceCommit = /^git:([0-9a-f]{40})$/.exec(generated.source)?.[1];
        if (sourceCommit === undefined) {
            errors.push(`${generated.path}: source must be an immutable Git commit`);
        } else {
            try {
                const sourceContents = execFileSync('git', ['show', `${sourceCommit}:${generated.path}`], {
                    cwd: root,
                });
                if (sha256(sourceContents) !== generated.sha256) {
                    errors.push(`${generated.path}: immutable source does not match SHA-256`);
                }
            } catch {
                errors.push(`${generated.path}: immutable source cannot be read`);
            }
        }
    }

    return errors;
}

export function levainRecordsSha256(contents: string): string {
    const marker = `${columns.join('\t')}\n`;
    const start = contents.indexOf(marker);
    if (start === -1) {
        throw new Error('Malformed Levain provenance columns');
    }
    return sha256(Buffer.from(contents.slice(start + marker.length)));
}

export function validateLevainUpstream(
    provenance: LevainProvenance,
    commit: UpstreamCommit,
    tree: UpstreamTree
): string[] {
    const errors: string[] = [];
    if (commit.sha !== provenance.source.revision) {
        errors.push('upstream commit does not match the release pin');
    }
    if (commit.commit.tree.sha !== provenance.source.tree) {
        errors.push('upstream commit tree does not match the release pin');
    }
    if (tree.truncated) {
        errors.push('upstream tree response is truncated');
    }
    const blobs = new Map(tree.tree.filter((entry) => entry.type === 'blob').map((entry) => [entry.path, entry.sha]));
    if (blobs.get(provenance.source.licensePath) !== provenance.source.licenseBlob) {
        errors.push('upstream license blob does not match the release pin');
    }
    for (const sample of provenance.samples) {
        if (blobs.get(sample.sourcePath) !== sample.gitBlob) {
            errors.push(`${sample.path}: upstream path does not match Git blob`);
        }
    }
    return errors;
}

export async function verifyLevainUpstream(provenance: LevainProvenance): Promise<void> {
    const api = 'https://api.github.com/repos/sgossner/VSCO-2-CE';
    const [commitResponse, treeResponse] = await Promise.all([
        fetch(`${api}/commits/${provenance.source.revision}`),
        fetch(`${api}/git/trees/${provenance.source.revision}?recursive=1`),
    ]);
    if (!commitResponse.ok || !treeResponse.ok) {
        throw new Error(
            `Levain upstream verification failed: commit ${commitResponse.status}, tree ${treeResponse.status}`
        );
    }
    const errors = validateLevainUpstream(
        provenance,
        (await commitResponse.json()) as UpstreamCommit,
        (await treeResponse.json()) as UpstreamTree
    );
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
}

export function checkLevainProvenance(root: string): LevainProvenance {
    const contents = readFileSync(resolve(root, provenancePath), 'utf8');
    const provenance = parseLevainProvenance(contents);
    const errors = validateLevainProvenance(root, provenance);
    if (levainRecordsSha256(contents) !== LEVAIN_SOURCE.recordsSha256) {
        errors.push('Levain provenance record set does not match the release pin');
    }
    if (errors.length > 0) {
        throw new Error(errors.join('\n\n'));
    }
    return provenance;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    const provenance = checkLevainProvenance(root);
    if (process.argv.includes('--verify-upstream')) {
        await verifyLevainUpstream(provenance);
    }
    process.stdout.write(
        `Levain provenance valid: ${String(provenance.samples.length)} samples, ${String(provenance.generatedFiles.length)} generated files\n`
    );
}

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

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

function sha256(contents: Buffer): string {
    return createHash('sha256').update(contents).digest('hex');
}

function gitBlob(contents: Buffer): string {
    return createHash('sha1')
        .update(`blob ${String(contents.length)}\0`)
        .update(contents)
        .digest('hex');
}

function filesBelow(root: string, directory: string): string[] {
    return readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(root, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'))
        .sort();
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
            provenance.samples.push({ path, sourcePath: source, gitBlob: blob, sha256: fileSha256 });
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
    if (provenance.source.repository !== 'https://github.com/sgossner/VSCO-2-CE') {
        errors.push('Levain provenance repository is not VSCO-2-CE');
    }
    if (!/^[0-9a-f]{40}$/.test(provenance.source.revision)) {
        errors.push('Levain source revision must be a commit');
    }
    if (!/^[0-9a-f]{40}$/.test(provenance.source.tree)) {
        errors.push('Levain source tree must be a Git tree');
    }
    if (provenance.source.license !== 'CC0-1.0') {
        errors.push('Levain source license must be CC0-1.0');
    }
    if (provenance.source.licensePath !== 'LICENSE') {
        errors.push('Levain source licensePath must be LICENSE');
    }
    if (!/^[0-9a-f]{40}$/.test(provenance.source.licenseBlob)) {
        errors.push('Levain source licenseBlob must be a Git blob');
    }

    const entries = [...provenance.samples, ...provenance.generatedFiles];
    const paths = entries.map((entry) => entry.path);
    const duplicates = duplicateValues(paths);
    if (duplicates.length > 0) {
        errors.push(`duplicate Levain provenance paths:\n${duplicates.join('\n')}`);
    }

    const actualPaths = filesBelow(root, sampleRoot).filter((path) => path !== provenancePath);
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
        if (provenance.source.license !== 'CC0-1.0') {
            errors.push(`${sample.path}: source license must be CC0-1.0`);
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
        if (!/^git:[0-9a-f]{40}$/.test(generated.source) && !existsSync(resolve(root, generated.source))) {
            errors.push(`${generated.path}: source must exist`);
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
    }

    return errors;
}

export function checkLevainProvenance(root: string): { samples: number; generatedFiles: number } {
    const provenance = parseLevainProvenance(readFileSync(resolve(root, provenancePath), 'utf8'));
    const errors = validateLevainProvenance(root, provenance);
    if (errors.length > 0) {
        throw new Error(errors.join('\n\n'));
    }
    return { samples: provenance.samples.length, generatedFiles: provenance.generatedFiles.length };
}

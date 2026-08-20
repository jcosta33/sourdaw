import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';

import type { LevainProvenance } from './checkLevainProvenance.ts';

type TreeEntry = { mode: string; type: string; sha: string; path: string };

const commitPath = 'release/levain-upstream-commit.base64';
const licensePath = 'release/levain-CC0-1.0.txt';
const treePath = 'release/levain-upstream-tree.tsv';

export function gitObjectSha(type: 'blob' | 'commit' | 'tree', contents: Buffer): string {
    return createHash('sha1')
        .update(`${type} ${String(contents.length)}\0`)
        .update(contents)
        .digest('hex');
}

function parseTreeProof(contents: string): { revision: string; tree: string; entries: TreeEntry[] } {
    const lines = contents.trimEnd().split('\n');
    const revision = lines.shift()?.split('\t');
    const tree = lines.shift()?.split('\t');
    if (
        revision?.length !== 3 ||
        revision[0] !== '#' ||
        revision[1] !== 'revision' ||
        tree?.length !== 3 ||
        tree[0] !== '#' ||
        tree[1] !== 'tree' ||
        lines.shift() !== 'mode\ttype\tsha\tpath'
    ) {
        throw new Error('Malformed Levain upstream tree metadata');
    }
    const entries = lines.map((line) => {
        const [mode, type, sha, path, ...extra] = line.split('\t');
        if (
            extra.length > 0 ||
            mode === undefined ||
            type === undefined ||
            sha === undefined ||
            path === undefined ||
            !/^[0-9a-f]{6}$/.test(mode) ||
            !['blob', 'tree'].includes(type) ||
            !/^[0-9a-f]{40}$/.test(sha) ||
            path === '' ||
            path.startsWith('/') ||
            path.split('/').includes('..')
        ) {
            throw new Error(`Malformed Levain upstream tree row: ${line}`);
        }
        return { mode, type, sha, path };
    });
    return { revision: revision[2]!, tree: tree[2]!, entries };
}

function treeBody(entries: TreeEntry[]): Buffer {
    const sorted = entries.slice().sort((left, right) => {
        const leftName = `${posix.basename(left.path)}${left.type === 'tree' ? '/' : ''}`;
        const rightName = `${posix.basename(right.path)}${right.type === 'tree' ? '/' : ''}`;
        return Buffer.from(leftName).compare(Buffer.from(rightName));
    });
    return Buffer.concat(
        sorted.flatMap((entry) => [
            Buffer.from(`${entry.mode.replace(/^0+/, '')} ${posix.basename(entry.path)}\0`),
            Buffer.from(entry.sha, 'hex'),
        ])
    );
}

export function validateLevainUpstreamProof(
    provenance: LevainProvenance,
    commitContents: Buffer,
    licenseContents: Buffer,
    treeContents: string
): string[] {
    const errors: string[] = [];
    const proof = parseTreeProof(treeContents);
    if (proof.revision !== provenance.source.revision) {
        errors.push('upstream proof revision does not match provenance');
    }
    if (proof.tree !== provenance.source.tree) {
        errors.push('upstream proof tree does not match provenance');
    }
    if (gitObjectSha('commit', commitContents) !== provenance.source.revision) {
        errors.push('upstream commit object does not match provenance');
    }
    if (!commitContents.toString('utf8').startsWith(`tree ${provenance.source.tree}\n`)) {
        errors.push('upstream commit does not point to the proven tree');
    }
    if (gitObjectSha('blob', licenseContents) !== provenance.source.licenseBlob) {
        errors.push('upstream license object does not match provenance');
    }

    const paths = proof.entries.map((entry) => entry.path);
    const duplicates = [...new Set(paths.filter((path, index) => paths.indexOf(path) !== index))].sort();
    if (duplicates.length > 0) {
        errors.push(`duplicate upstream proof paths:\n${duplicates.join('\n')}`);
    }
    const entriesByPath = new Map(proof.entries.map((entry) => [entry.path, entry]));
    const childrenByDirectory = new Map<string, TreeEntry[]>();
    for (const entry of proof.entries) {
        const directory = posix.dirname(entry.path) === '.' ? '' : posix.dirname(entry.path);
        const children = childrenByDirectory.get(directory) ?? [];
        children.push(entry);
        childrenByDirectory.set(directory, children);
    }
    for (const [directory, children] of childrenByDirectory) {
        const expected = directory === '' ? provenance.source.tree : entriesByPath.get(directory)?.sha;
        if (expected === undefined || gitObjectSha('tree', treeBody(children)) !== expected) {
            errors.push(`${directory || '<root>'}: upstream tree object does not match`);
        }
    }
    for (const entry of proof.entries.filter((candidate) => candidate.type === 'tree')) {
        if (!childrenByDirectory.has(entry.path)) {
            errors.push(`${entry.path}: upstream tree has no proven children`);
        }
    }
    if (entriesByPath.get(provenance.source.licensePath)?.sha !== provenance.source.licenseBlob) {
        errors.push('upstream tree does not contain the proven license');
    }
    for (const sample of provenance.samples) {
        const source = entriesByPath.get(sample.sourcePath);
        if (source?.type !== 'blob' || source.sha !== sample.gitBlob) {
            errors.push(`${sample.path}: upstream path does not match Git blob`);
        }
    }
    return errors;
}

export function checkLevainUpstreamProof(root: string, provenance: LevainProvenance): void {
    const errors = validateLevainUpstreamProof(
        provenance,
        Buffer.from(readFileSync(resolve(root, commitPath), 'utf8').trim(), 'base64'),
        readFileSync(resolve(root, licensePath)),
        readFileSync(resolve(root, treePath), 'utf8')
    );
    if (errors.length > 0) {
        throw new Error(errors.join('\n\n'));
    }
}

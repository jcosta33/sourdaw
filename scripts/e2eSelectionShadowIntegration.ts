import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { isPlaywrightCollected } from './vitestCollectionPatterns.ts';

export type InventoryRow = { path: string; gitBlob: string; sha256: string; mode: string };

export function sortInventoryRows(rows: InventoryRow[]): InventoryRow[] {
    return rows.sort((a, b) => {
        if (a.path < b.path) {
            return -1;
        }
        if (a.path > b.path) {
            return 1;
        }
        return 0;
    });
}

type InventoryFileAccess = {
    open: (file: string, flags: number) => number;
    fstat: (fd: number) => ReturnType<typeof fstatSync>;
    read: (fd: number) => Buffer;
    close: (fd: number) => void;
};

const SHA = /^[0-9a-f]{40}$/;

function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

export function git(args: string[], cwd?: string): Buffer {
    return execFileSync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
}

export function treeEntry(ref: string, path: string, cwd?: string): { mode: string; blob: string } | null {
    const raw = git(['ls-tree', '-z', ref, '--', `:(literal)${path}`], cwd).toString('utf8');
    if (raw === '') {
        return null;
    }
    const match = /^(\d+) blob ([0-9a-f]{40})\t([^\0]+)\0$/.exec(raw);
    if (!match || match[3] !== path) {
        throw new Error(`Invalid tree entry: ${path}`);
    }
    return { mode: match[1] ?? '', blob: match[2] ?? '' };
}

const inventoryFileAccess: InventoryFileAccess = {
    open: openSync,
    fstat: fstatSync,
    read: (fd) => readFileSync(fd),
    close: closeSync,
};

export function hashInventoryFile(file: string, access: InventoryFileAccess = inventoryFileAccess): string {
    let fd: number;
    try {
        fd = access.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ELOOP') {
            return 'missing';
        }
        throw error;
    }
    try {
        return access.fstat(fd).isFile() ? sha256(access.read(fd)) : 'missing';
    } finally {
        access.close(fd);
    }
}

function trackedSpecPaths(root: string, ref: string): string[] {
    return git(['ls-tree', '-r', '-z', '--name-only', ref, '--', 'tests/e2e'], root)
        .toString('utf8')
        .split('\0')
        .filter(isPlaywrightCollected)
        .sort();
}

export function listInventory(root: string, head: string): InventoryRow[] {
    const rows: InventoryRow[] = [];
    for (const entry of readdirSync(resolve(root, 'tests/e2e'), { recursive: true, withFileTypes: true })) {
        const path = relative(root, resolve(entry.parentPath, entry.name));
        if (!isPlaywrightCollected(path)) {
            continue;
        }
        const tree = treeEntry(head, path, root);
        const mode = tree?.mode ?? 'missing';
        const file = resolve(root, path);
        const sha = entry.isFile() ? hashInventoryFile(file) : 'missing';
        if (mode === '100644' && sha !== sha256(git(['show', `${head}:${path}`], root))) {
            throw new Error(`Candidate inventory bytes disagree with Git blob: ${path}`);
        }
        rows.push({ path, gitBlob: tree?.blob ?? 'missing', sha256: sha, mode });
    }
    if (JSON.stringify(rows.map((row) => row.path).sort()) !== JSON.stringify(trackedSpecPaths(root, head))) {
        throw new Error('Candidate inventory checkout disagrees with Git tree');
    }
    return rows;
}

export function listIntegrationInventory(root: string, integrationSha: string): InventoryRow[] {
    const tracked = trackedSpecPaths(root, integrationSha);
    const rows: InventoryRow[] = [];
    for (const entry of readdirSync(resolve(root, 'tests/e2e'), { recursive: true, withFileTypes: true })) {
        const path = relative(root, resolve(entry.parentPath, entry.name));
        if (!isPlaywrightCollected(path)) {
            continue;
        }
        if (!entry.isFile()) {
            throw new Error(`Integration inventory is not regular: ${path}`);
        }
        const tree = treeEntry(integrationSha, path, root);
        if (tree?.mode !== '100644') {
            throw new Error(`Integration inventory Git mode is not regular: ${path}`);
        }
        const sha = hashInventoryFile(resolve(root, path));
        if (sha !== sha256(git(['show', `${integrationSha}:${path}`], root))) {
            throw new Error(`Integration inventory bytes disagree with Git blob: ${path}`);
        }
        rows.push({ path, gitBlob: tree.blob, sha256: sha, mode: tree.mode });
    }
    if (JSON.stringify(rows.map((row) => row.path).sort()) !== JSON.stringify(tracked)) {
        throw new Error('Integration inventory checkout disagrees with Git tree');
    }
    return rows;
}

export function readIntegrationSourceHashes(
    root: string,
    integrationSha: string,
    paths: readonly string[]
): Record<string, string> {
    return Object.fromEntries(
        paths.map((path) => {
            const entry = treeEntry(integrationSha, path, root);
            if (entry?.mode !== '100644') {
                return [path, 'missing-or-nonregular'];
            }
            return [path, sha256(git(['show', `${integrationSha}:${path}`], root))];
        })
    );
}

export function readHeadSourceBindings(
    root: string,
    head: string,
    paths: readonly string[],
    checkedOutRules: readonly string[]
): { sourceModes: Record<string, string>; sourceHashes: Record<string, string> } {
    const sourceModes = Object.fromEntries(paths.map((path) => [path, treeEntry(head, path, root)?.mode ?? 'missing']));
    const sourceHashes = Object.fromEntries(
        paths.map((path) => [
            path,
            sourceModes[path] === '100644' ? sha256(git(['show', `${head}:${path}`], root)) : 'missing-or-nonregular',
        ])
    );
    for (const path of checkedOutRules) {
        if (sourceModes[path] !== '100644' || hashInventoryFile(resolve(root, path)) !== sourceHashes[path]) {
            throw new Error(`Shadow rule in checkout disagrees with the immutable head: ${path}`);
        }
    }
    return { sourceModes, sourceHashes };
}

export function verifyIntegrationCheckout(root: string, integrationSha: string, head: string, base: string): void {
    if (![integrationSha, head, base].every((sha) => SHA.test(sha))) {
        throw new Error('Integration lineage requires immutable SHAs');
    }
    if (git(['rev-parse', 'HEAD'], root).toString('utf8').trim() !== integrationSha) {
        throw new Error('Integration checkout does not match the immutable merge SHA');
    }
    const parents = git(['rev-list', '--parents', '-n', '1', integrationSha], root).toString('utf8').trim().split(' ');
    if (parents.length !== 3 || parents[0] !== integrationSha || parents[2] !== head) {
        throw new Error('Integration commit is not a two-parent merge of the candidate head');
    }
    const firstParent = parents[1];
    if (!firstParent || git(['merge-base', base, firstParent], root).toString('utf8').trim() !== base) {
        throw new Error('Integration first parent does not descend from the event base');
    }
}

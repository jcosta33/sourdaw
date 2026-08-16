#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETENTION_CLASSES = [
    'keep',
    'keep-with-obligations',
    'defer-behind-admission',
    'remove-proven-incompatible',
] as const;

type RetentionClass = (typeof RETENTION_CLASSES)[number];

type ReleaseSurface = {
    id: string;
    kind: string;
    retention: RetentionClass;
    owner: string;
    releaseModes: string[];
    paths: string[];
    sources: string[];
    revisions: string[];
    digests: string[];
    licenses: string[];
    productSurfaces: string[];
    evidence: string[];
    obligations: string[];
};

export type ReleaseInventory = {
    schemaVersion: number;
    surfaces: ReleaseSurface[];
    snapshots: Array<{ path: string; sha256: string }>;
    externalReferences: Array<{ surface: string; file: string; value: string }>;
    marks: Array<{ value: string; paths: string[] }>;
};

export type RepositorySnapshot = {
    releaseFiles: string[];
    externalReferences: Array<{ file: string; value: string }>;
    fileDigests: Record<string, string>;
    markPaths: Record<string, string[]>;
};

const scannedExtensions = new Set(['.js', '.json', '.mjs', '.plist', '.py', '.rs', '.sh', '.ts', '.tsx', '.xml']);
const markExtensions = new Set([...scannedExtensions, '.css', '.html', '.md', '.toml', '.txt', '.yaml', '.yml']);
const ignoredUrlHosts = new Set([
    '127.0.0.1',
    'localhost',
    'schema.tauri.app',
    'schemas.android.com',
    'schemas.microsoft.com',
    'www.apple.com',
    'www.w3.org',
]);

function sortedUnique(values: string[]): string[] {
    return [...new Set(values)].sort();
}

function isScannedSource(path: string): boolean {
    if (!['scripts/', 'src/', 'src-tauri/'].some((root) => path.startsWith(root))) {
        return false;
    }
    if (path.includes('/__tests__/') || path.includes('/tests/') || /\.(spec|test)\./.test(path)) {
        return false;
    }
    if (path.startsWith('src-tauri/gen/schemas/')) {
        return false;
    }
    return scannedExtensions.has(extname(path));
}

function isMarkSource(path: string): boolean {
    if (path !== 'README.md' && !['docs/', 'scripts/', 'src/', 'src-tauri/'].some((root) => path.startsWith(root))) {
        return false;
    }
    if (path.includes('/__tests__/') || path.includes('/tests/') || /\.(spec|test)\./.test(path)) {
        return false;
    }
    return markExtensions.has(extname(path));
}

function containsMark(contents: string, value: string): boolean {
    const escaped = value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`).test(contents);
}

function externalUrls(contents: string): string[] {
    const normalized = contents.replaceAll('\\/', '/');
    const matches = normalized.match(/(?:https?|wss?):\/\/[^\s'"`<>\\)]+|(?:stun|turn):[^\s'"`<>\\)]+/g) ?? [];
    return matches
        .map((value) => value.replace(/[;,]+$/, ''))
        .filter((value) => {
            if (value.startsWith('stun:') || value.startsWith('turn:')) {
                return true;
            }
            try {
                const url = new URL(value);
                return (
                    !ignoredUrlHosts.has(url.hostname) &&
                    !url.hostname.endsWith('.example') &&
                    !url.hostname.endsWith('.example.com') &&
                    !url.hostname.endsWith('.invalid') &&
                    !url.hostname.endsWith('.localhost')
                );
            } catch {
                return false;
            }
        });
}

function pathMatches(rule: string, path: string): boolean {
    if (!rule.endsWith('/**')) {
        return rule === path;
    }
    const directory = rule.slice(0, -3);
    return path === directory || path.startsWith(`${directory}/`);
}

function surfaceCoversPath(surface: ReleaseSurface, path: string): boolean {
    return surface.paths.some((rule) => pathMatches(rule, path));
}

function formatMissing(label: string, values: string[]): string | undefined {
    return values.length === 0 ? undefined : `${label}:\n${values.map((value) => `- ${value}`).join('\n')}`;
}

export function validateReleaseInventory(inventory: ReleaseInventory, snapshot: RepositorySnapshot): string[] {
    const errors: Array<string | undefined> = [];
    if (inventory.schemaVersion !== 1) {
        errors.push('schemaVersion must be 1');
    }
    if (!Array.isArray(inventory.surfaces)) {
        return [...errors.filter((error): error is string => error !== undefined), 'surfaces must be an array'];
    }

    const ids = inventory.surfaces.map((surface) => surface.id);
    errors.push(
        formatMissing(
            'duplicate surface IDs',
            ids.filter((id, index) => ids.indexOf(id) !== index)
        )
    );

    for (const surface of inventory.surfaces) {
        if (!RETENTION_CLASSES.includes(surface.retention)) {
            errors.push(`${surface.id}: invalid retention class ${String(surface.retention)}`);
        }
        for (const [field, values] of Object.entries({
            owner: [surface.owner],
            releaseModes: surface.releaseModes,
            paths: surface.paths,
            sources: surface.sources,
            revisions: surface.revisions,
            digests: surface.digests,
            licenses: surface.licenses,
            productSurfaces: surface.productSurfaces,
            evidence: surface.evidence,
            obligations: surface.obligations,
        })) {
            if (!Array.isArray(values) || values.length === 0 || values.some((value) => value.trim() === '')) {
                errors.push(`${surface.id}: ${field} must be non-empty`);
            }
        }
    }

    const uncoveredReleaseFiles = snapshot.releaseFiles.filter(
        (path) => !inventory.surfaces.some((surface) => surfaceCoversPath(surface, path))
    );
    errors.push(formatMissing('unclassified release files', uncoveredReleaseFiles));

    if (!Array.isArray(inventory.snapshots)) {
        errors.push('snapshots must be an array');
    } else {
        const paths = inventory.snapshots.map((entry) => entry.path);
        errors.push(
            formatMissing(
                'duplicate snapshot paths',
                paths.filter((path, index) => paths.indexOf(path) !== index)
            )
        );
        for (const entry of inventory.snapshots) {
            if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
                errors.push(`${entry.path}: snapshot must be a SHA-256 digest`);
            } else if (snapshot.fileDigests[entry.path] !== entry.sha256) {
                errors.push(`${entry.path}: snapshot drifted`);
            }
        }
    }

    const surfaceIds = new Set(ids);
    const surfacesById = new Map(inventory.surfaces.map((surface) => [surface.id, surface]));
    const assignedReferences = Array.isArray(inventory.externalReferences) ? inventory.externalReferences : [];
    if (!Array.isArray(inventory.externalReferences)) {
        errors.push('externalReferences must be an array');
    }
    for (const reference of assignedReferences) {
        if (!surfaceIds.has(reference.surface)) {
            errors.push(`${reference.file}: unknown surface ${reference.surface}`);
        } else if (!surfaceCoversPath(surfacesById.get(reference.surface)!, reference.file)) {
            errors.push(`${reference.file}: ${reference.surface} does not cover the referenced file`);
        }
    }
    const referenceKey = (reference: { file: string; value: string }): string =>
        `${reference.file}\u0000${reference.value}`;
    const expectedReferenceKeys = sortedUnique(assignedReferences.map(referenceKey));
    const actualReferenceKeys = sortedUnique(snapshot.externalReferences.map(referenceKey));
    errors.push(
        formatMissing(
            'external references missing from inventory',
            actualReferenceKeys
                .filter((key) => !expectedReferenceKeys.includes(key))
                .map((key) => key.replace('\u0000', ' -> '))
        )
    );
    errors.push(
        formatMissing(
            'stale external-reference assignments',
            expectedReferenceKeys
                .filter((key) => !actualReferenceKeys.includes(key))
                .map((key) => key.replace('\u0000', ' -> '))
        )
    );

    if (!Array.isArray(inventory.marks)) {
        errors.push('marks must be an array');
    } else {
        const values = inventory.marks.map((mark) => mark.value);
        errors.push(
            formatMissing(
                'duplicate mark values',
                values.filter((value, index) => values.indexOf(value) !== index)
            )
        );
        for (const mark of inventory.marks) {
            const expected = sortedUnique(mark.paths);
            const actual = snapshot.markPaths[mark.value] ?? [];
            errors.push(
                formatMissing(
                    `${mark.value}: unclassified mark paths`,
                    actual.filter((path) => !expected.includes(path))
                )
            );
            errors.push(
                formatMissing(
                    `${mark.value}: stale mark paths`,
                    expected.filter((path) => !actual.includes(path))
                )
            );
        }
    }

    return errors.filter((error): error is string => error !== undefined);
}

export function loadRepositorySnapshot(
    root: string,
    inventory: Pick<ReleaseInventory, 'snapshots' | 'marks'>,
    trackedFiles?: string[]
): RepositorySnapshot {
    const files =
        trackedFiles ?? execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    const contents = new Map<string, string>();
    const readText = (path: string): string => {
        const cached = contents.get(path);
        if (cached !== undefined) {
            return cached;
        }
        const value = readFileSync(resolve(root, path), 'utf8');
        contents.set(path, value);
        return value;
    };
    const scannedFiles = files.filter(isScannedSource);
    const markFiles = files.filter(isMarkSource);
    const externalReferences = scannedFiles.flatMap((path) =>
        externalUrls(readText(path)).map((value) => ({ file: path, value }))
    );
    const fileDigests = Object.fromEntries(
        (inventory.snapshots ?? []).map((entry) => {
            try {
                return [
                    entry.path,
                    createHash('sha256')
                        .update(readFileSync(resolve(root, entry.path)))
                        .digest('hex'),
                ];
            } catch {
                return [entry.path, 'missing'];
            }
        })
    );
    const markPaths = Object.fromEntries(
        (inventory.marks ?? []).map((mark) => [
            mark.value,
            markFiles.filter((path) => containsMark(readText(path), mark.value)).sort(),
        ])
    );
    return {
        releaseFiles: files.sort(),
        externalReferences: sortedUnique(externalReferences.map((entry) => `${entry.file}\u0000${entry.value}`)).map(
            (entry) => {
                const [file, value] = entry.split('\u0000');
                return { file: file ?? '', value: value ?? '' };
            }
        ),
        fileDigests,
        markPaths,
    };
}

export function checkReleaseInventory(root: string): void {
    const inventoryPath = resolve(root, 'release/open-source-inventory.json');
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as ReleaseInventory;
    const snapshot = loadRepositorySnapshot(root, inventory);
    const errors = validateReleaseInventory(inventory, snapshot);
    if (errors.length > 0) {
        throw new Error(errors.join('\n\n'));
    }
    process.stdout.write(
        `release inventory valid: ${String(inventory.surfaces.length)} surfaces, ${String(snapshot.releaseFiles.length)} files, ${String(snapshot.externalReferences.length)} external references\n`
    );
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    checkReleaseInventory(resolve(fileURLToPath(new URL('..', import.meta.url))));
}

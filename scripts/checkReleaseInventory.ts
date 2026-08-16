#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
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
    sourceFiles: string[];
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
    baseline: string;
    surfaces: ReleaseSurface[];
};

export type RepositorySnapshot = {
    releaseFiles: string[];
    externalSourceFiles: string[];
};

const releaseManifestPattern = /(^|\/)(Cargo\.toml|package\.json)$/;
const scannedExtensions = new Set(['.js', '.json', '.mjs', '.plist', '.py', '.rs', '.sh', '.ts', '.tsx', '.xml']);
const shippedAssetExtensions = new Set([
    '.bin',
    '.data',
    '.flac',
    '.ico',
    '.jpeg',
    '.jpg',
    '.mp3',
    '.ogg',
    '.onnx',
    '.png',
    '.svg',
    '.wasm',
    '.wav',
    '.webp',
]);
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

function isReleaseFile(path: string): boolean {
    return (
        path === 'Cargo.lock' ||
        path === 'pnpm-lock.yaml' ||
        path.startsWith('public/') ||
        path.startsWith('src-tauri/sidecar/') ||
        shippedAssetExtensions.has(extname(path).toLowerCase()) ||
        releaseManifestPattern.test(path)
    );
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

function externalUrls(contents: string): string[] {
    const matches = contents.match(/(?:https?|wss?):\/\/[^\s'"`<>\\)]+|(?:stun|turn):[^\s'"`<>\\)]+/g) ?? [];
    return matches.filter((value) => {
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
    return rule.endsWith('/**') ? path.startsWith(rule.slice(0, -2)) : rule === path;
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
    if (!/^[0-9a-f]{40}$/.test(inventory.baseline)) {
        errors.push('baseline must be a full Git commit SHA');
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

    const assignedSourceFiles = sortedUnique(inventory.surfaces.flatMap((surface) => surface.sourceFiles));
    errors.push(
        formatMissing(
            'external-source files missing from inventory',
            snapshot.externalSourceFiles.filter((path) => !assignedSourceFiles.includes(path))
        )
    );
    errors.push(
        formatMissing(
            'stale external-source assignments',
            assignedSourceFiles.filter((path) => !snapshot.externalSourceFiles.includes(path))
        )
    );

    return errors.filter((error): error is string => error !== undefined);
}

export function loadRepositorySnapshot(root: string, trackedFiles?: string[]): RepositorySnapshot {
    const files =
        trackedFiles ?? execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    const externalSourceFiles = files.filter(isScannedSource).filter((path) => {
        const contents = readFileSync(resolve(root, path), 'utf8');
        return externalUrls(contents).length > 0;
    });
    return {
        releaseFiles: files.filter(isReleaseFile).sort(),
        externalSourceFiles: externalSourceFiles.sort(),
    };
}

export function checkReleaseInventory(root: string): void {
    const inventoryPath = resolve(root, 'release/open-source-inventory.json');
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as ReleaseInventory;
    const snapshot = loadRepositorySnapshot(root);
    const errors = validateReleaseInventory(inventory, snapshot);
    if (errors.length > 0) {
        throw new Error(errors.join('\n\n'));
    }
    process.stdout.write(
        `release inventory valid: ${String(inventory.surfaces.length)} surfaces, ${String(snapshot.releaseFiles.length)} release files, ${String(snapshot.externalSourceFiles.length)} external-source files\n`
    );
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    checkReleaseInventory(resolve(fileURLToPath(new URL('..', import.meta.url))));
}

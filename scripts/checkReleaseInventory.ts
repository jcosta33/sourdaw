#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkLevainProvenance } from './checkLevainProvenance.ts';

export const RETENTION_CLASSES = [
    'keep',
    'keep-with-obligations',
    'defer-behind-admission',
    'remove-proven-incompatible',
] as const;

export const REQUIRED_SNAPSHOT_PATHS = [
    'package.json',
    'server/package.json',
    'server/package-lock.json',
    'pnpm-lock.yaml',
    'Cargo.toml',
    'Cargo.lock',
    'src/modules/AiRuntime/repositories/webLlm/webLlmArtifactManifest.generated.json',
    'public/wasm/manifest.json',
] as const;

export const REQUIRED_MARKS = [
    '1176',
    'AC30',
    'Clavinet',
    'CS-80',
    'DX7',
    'Fender',
    'Hammond',
    'JCM',
    'Juno',
    'LA-2A',
    'Leslie',
    'Marshall',
    'Mellotron',
    'Minimoog',
    'Moog',
    'MPC-60',
    'MS-20',
    'Oberheim',
    'OB-X',
    'Prophet',
    'Rhodes',
    'Roland',
    'SEM',
    'SH-101',
    'SSL',
    'Steinway',
    'TB-303',
    'TR-808',
    'TR-909',
    'Vox',
    'Wurlitzer',
    'Yamaha',
] as const;

export const REQUIRED_COMPONENT_PATHS: Readonly<Record<string, readonly string[]>> = {
    'rave-models': [
        'src/modules/BrowserAi/handlers/rave/**',
        'src/modules/BrowserAi/stores/rave.ts',
        'src/modules/BrowserAi/useCases/getRaveHandlers.ts',
        'src/modules/BrowserAi/useCases/initRaveModels.ts',
        'src/modules/BrowserAi/useCases/rave/**',
    ],
};

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

type ExternalReference = {
    file: string;
    value: string;
    templateSha256?: string;
};

export type ReleaseInventory = {
    schemaVersion: number;
    surfaces: ReleaseSurface[];
    snapshots: Array<{ path: string; sha256: string }>;
    externalReferences: Array<ExternalReference & { surface: string }>;
    marks: Array<{ value: string; paths: string[] }>;
};

export type RepositorySnapshot = {
    releaseFiles: string[];
    externalReferences: ExternalReference[];
    fileDigests: Record<string, string>;
    markPaths: Record<string, string[]>;
};

const scannedExtensions = new Set(['.js', '.json', '.mjs', '.plist', '.py', '.rs', '.sh', '.ts', '.tsx', '.xml']);
const markExtensions = new Set([...scannedExtensions, '.css', '.html', '.md', '.toml', '.txt', '.yaml', '.yml']);
const ignoredUrlHosts = new Set([
    '127.0.0.1',
    'emscripten.org',
    'localhost',
    'schemas.android.com',
    'schemas.microsoft.com',
    'www.apple.com',
    'www.w3.org',
]);

function sortedUnique(values: string[]): string[] {
    return [...new Set(values)].sort();
}

function isScannedSource(path: string): boolean {
    if (!['crates/', 'electron/', 'public/', 'scripts/', 'server/', 'src/'].some((root) => path.startsWith(root))) {
        return false;
    }
    if (path.includes('/__tests__/') || path.includes('/tests/') || /\.(spec|test)\./.test(path)) {
        return false;
    }
    if (path.endsWith('package-lock.json')) {
        return false;
    }
    return scannedExtensions.has(extname(path));
}

function isMarkSource(path: string): boolean {
    if (
        !['README.md', 'index.html'].includes(path) &&
        !['docs/', 'public/', 'src/'].some((root) => path.startsWith(root))
    ) {
        return false;
    }
    if (path.includes('/__tests__/') || path.includes('/tests/') || /\.(spec|test)\./.test(path)) {
        return false;
    }
    return markExtensions.has(extname(path));
}

function containsMark(contents: string, value: string): boolean {
    const escaped = value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, 'i').test(contents);
}

function canonicalizeTemplate(value: string): { value: string; templateSha256?: string } {
    let canonical = '';
    let dynamic = false;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== '$' || value[index + 1] !== '{') {
            canonical += value[index];
            continue;
        }

        dynamic = true;
        let depth = 1;
        let quote: string | undefined;
        index += 2;
        for (; index < value.length && depth > 0; index += 1) {
            const character = value[index]!;
            if (quote !== undefined) {
                if (character === '\\') {
                    index += 1;
                } else if (character === quote) {
                    quote = undefined;
                }
            } else if (character === "'" || character === '"' || character === '`') {
                quote = character;
            } else if (character === '{') {
                depth += 1;
            } else if (character === '}') {
                depth -= 1;
            }
        }
        index -= 1;
        canonical += '${slot}';
    }
    return dynamic
        ? { value: canonical, templateSha256: createHash('sha256').update(value).digest('hex') }
        : { value: canonical };
}

function isExternalUrl(value: string): boolean {
    if (value.startsWith('stun:') || value.startsWith('turn:')) {
        return true;
    }
    try {
        const url = new URL(value.replaceAll('${slot}', '1'));
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
}

function stringLiterals(contents: string): string[] {
    const values: string[] = [];
    for (let index = 0; index < contents.length; index += 1) {
        const character = contents[index]!;
        const next = contents[index + 1];
        if (character === '/' && next === '/') {
            index = contents.indexOf('\n', index + 2);
            if (index === -1) {
                break;
            }
            continue;
        }
        if (character === '/' && next === '*') {
            const end = contents.indexOf('*/', index + 2);
            if (end === -1) {
                break;
            }
            index = end + 1;
            continue;
        }
        if (character === '#') {
            index = contents.indexOf('\n', index + 1);
            if (index === -1) {
                break;
            }
            continue;
        }
        if (character !== "'" && character !== '"' && character !== '`') {
            continue;
        }

        let value = '';
        for (index += 1; index < contents.length; index += 1) {
            const stringCharacter = contents[index]!;
            if (stringCharacter === '\\' && index + 1 < contents.length) {
                value += stringCharacter + contents[index + 1]!;
                index += 1;
            } else if (stringCharacter === character) {
                values.push(value);
                break;
            } else {
                value += stringCharacter;
            }
        }
    }
    return values;
}

function externalReferences(contents: string): Array<Omit<ExternalReference, 'file'>> {
    const references: Array<Omit<ExternalReference, 'file'>> = [];
    for (const literal of stringLiterals(contents)) {
        const body = literal.replaceAll('\\/', '/');
        const canonical = canonicalizeTemplate(body);
        const urls = canonical.value.match(/(?:https?|wss?):\/\/[^\s'"`<>\\)]+|(?:stun|turn):[^\s'"`<>\\)]+/g) ?? [];
        for (const url of urls) {
            const value = url.replace(/[;,]+$/, '');
            if (isExternalUrl(value)) {
                references.push({
                    value,
                    ...(canonical.templateSha256 && { templateSha256: canonical.templateSha256 }),
                });
            }
        }
    }
    if (/\bnew\s+WebSocket\s*\(/.test(contents)) {
        references.push({ value: 'runtime:WebSocket' });
    }
    if (/\bnew\s+WebSocketServer\s*\(/.test(contents)) {
        references.push({ value: 'runtime:WebSocketServer' });
    }
    return references;
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

function referenceKey(reference: ExternalReference): string {
    return `${reference.file}\u0000${reference.value}\u0000${reference.templateSha256 ?? ''}`;
}

function formatReferenceKey(key: string): string {
    const [file, value, templateSha256] = key.split('\u0000');
    return `${file} -> ${value}${templateSha256 ? ` [template sha256:${templateSha256}]` : ''}`;
}

export function validateReleaseInventory(
    inventory: ReleaseInventory,
    snapshot: RepositorySnapshot,
    requiredMarks: readonly string[] = [],
    requiredComponentPaths: Readonly<Record<string, readonly string[]>> = {}
): string[] {
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
        for (const path of surface.paths) {
            if (!snapshot.releaseFiles.some((trackedPath) => pathMatches(path, trackedPath))) {
                errors.push(`${surface.id}: path is not tracked: ${path}`);
            }
        }
    }

    const uncoveredReleaseFiles = snapshot.releaseFiles.filter(
        (path) => !inventory.surfaces.some((surface) => surfaceCoversPath(surface, path))
    );
    errors.push(formatMissing('unclassified release files', uncoveredReleaseFiles));

    for (const [surfaceId, paths] of Object.entries(requiredComponentPaths)) {
        const surface = inventory.surfaces.find((candidate) => candidate.id === surfaceId);
        if (surface === undefined) {
            errors.push(`required component surface missing: ${surfaceId}`);
            continue;
        }
        errors.push(
            formatMissing(
                `${surfaceId}: required component paths missing`,
                paths.filter((path) => !surface.paths.includes(path))
            )
        );
        for (const path of paths) {
            if (!snapshot.releaseFiles.some((trackedPath) => pathMatches(path, trackedPath))) {
                errors.push(`${surfaceId}: required component path is not tracked: ${path}`);
            }
        }
    }

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
        errors.push(
            formatMissing(
                'required snapshots missing from inventory',
                REQUIRED_SNAPSHOT_PATHS.filter((path) => !paths.includes(path))
            )
        );
        for (const entry of inventory.snapshots) {
            if (!snapshot.releaseFiles.includes(entry.path)) {
                errors.push(`${entry.path}: snapshot path must be tracked`);
            } else if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
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
    const expectedReferenceKeys = sortedUnique(assignedReferences.map(referenceKey));
    const actualReferenceKeys = sortedUnique(snapshot.externalReferences.map(referenceKey));
    errors.push(
        formatMissing(
            'external references missing from inventory',
            actualReferenceKeys.filter((key) => !expectedReferenceKeys.includes(key)).map(formatReferenceKey)
        )
    );
    errors.push(
        formatMissing(
            'stale external-reference assignments',
            expectedReferenceKeys.filter((key) => !actualReferenceKeys.includes(key)).map(formatReferenceKey)
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
        errors.push(
            formatMissing(
                'required marks missing from inventory',
                requiredMarks.filter((value) => !values.includes(value))
            )
        );
        for (const mark of inventory.marks) {
            if (!Array.isArray(mark.paths) || mark.paths.length === 0) {
                errors.push(`${mark.value}: paths must be non-empty`);
                continue;
            }
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
        if (requiredMarks.length > 0) {
            const markSurface = inventory.surfaces.find((surface) => surface.id === 'third-party-marks');
            if (markSurface === undefined) {
                errors.push('required component surface missing: third-party-marks');
            } else {
                const mappedPaths = sortedUnique(inventory.marks.flatMap((mark) => mark.paths));
                errors.push(
                    formatMissing(
                        'third-party-marks: candidate paths missing from surface',
                        mappedPaths.filter((path) => !markSurface.paths.includes(path))
                    )
                );
                errors.push(
                    formatMissing(
                        'third-party-marks: stale surface paths',
                        markSurface.paths.filter((path) => !mappedPaths.includes(path))
                    )
                );
            }
        }
    }

    return errors.filter((error): error is string => error !== undefined);
}

export function loadRepositorySnapshot(
    root: string,
    inventory: Pick<ReleaseInventory, 'snapshots' | 'marks'>,
    trackedFiles?: string[]
): RepositorySnapshot {
    const trackedFilesInWorktree =
        trackedFiles ?? execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    const files = trackedFilesInWorktree.filter((path) => existsSync(resolve(root, path)));
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
    const discoveredReferences = scannedFiles.flatMap((path) =>
        externalReferences(readText(path)).map((reference) => ({ file: path, ...reference }))
    );
    const snapshotPaths = sortedUnique([
        ...REQUIRED_SNAPSHOT_PATHS,
        ...(inventory.snapshots ?? []).map((entry) => entry.path),
    ]);
    const fileDigests = Object.fromEntries(
        snapshotPaths.map((path) => {
            try {
                return [
                    path,
                    createHash('sha256')
                        .update(readFileSync(resolve(root, path)))
                        .digest('hex'),
                ];
            } catch {
                return [path, 'missing'];
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
        externalReferences: sortedUnique(discoveredReferences.map((entry) => referenceKey(entry))).map((entry) => {
            const [file, value, templateSha256] = entry.split('\u0000');
            return { file: file ?? '', value: value ?? '', ...(templateSha256 && { templateSha256 }) };
        }),
        fileDigests,
        markPaths,
    };
}

export function checkReleaseInventory(root: string): void {
    const inventoryPath = resolve(root, 'release/open-source-inventory.json');
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as ReleaseInventory;
    const snapshot = loadRepositorySnapshot(root, inventory);
    const errors = validateReleaseInventory(inventory, snapshot, REQUIRED_MARKS, REQUIRED_COMPONENT_PATHS);
    if (errors.length > 0) {
        throw new Error(errors.join('\n\n'));
    }
    const levain = checkLevainProvenance(root);
    const levainSurface = inventory.surfaces.find((surface) => surface.id === 'levain-sample-bank');
    const levainContract = {
        sources: [levain.source.repository],
        revisions: [levain.source.revision],
        digests: [`git-tree:${levain.source.tree}`, 'file-level:public/samples/levain/provenance.tsv'],
        licenses: [levain.source.license, 'pending:OS-10-project-license'],
    };
    for (const [field, expected] of Object.entries(levainContract)) {
        if (JSON.stringify(levainSurface?.[field as keyof ReleaseSurface]) !== JSON.stringify(expected)) {
            throw new Error(`Levain release inventory ${field} does not match provenance`);
        }
    }
    process.stdout.write(
        `release inventory valid: ${String(inventory.surfaces.length)} surfaces, ${String(snapshot.releaseFiles.length)} files, ${String(snapshot.externalReferences.length)} external references, ${String(levain.samples.length)} Levain samples, ${String(levain.generatedFiles.length)} generated Levain files\n`
    );
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    checkReleaseInventory(resolve(fileURLToPath(new URL('..', import.meta.url))));
}

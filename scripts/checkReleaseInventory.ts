#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkElectronRuntimeProvenance, electronReleaseInventoryContract } from './checkElectronRuntimeProvenance.ts';
import { checkLevainProvenance } from './checkLevainProvenance.ts';
import { checkLgplRuntimeProvenance } from './checkLgplRuntimeProvenance.ts';
import { wasmArtifacts, type WasmManifest } from './wasm-artifacts.ts';

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

export const TRADEMARK_NOTICE_PATH = 'public/legal/TRADEMARKS.md';
export const TFJS_APACHE_LICENSE_PATH = 'public/legal/Apache-2.0.txt';
export const TFJS_NOTICE_PATH = 'public/legal/TensorFlow.js-NOTICE.txt';
export const MAGENTA_NOTICE_PATH = 'public/legal/Magenta.js-NOTICE.txt';
export const THIRD_PARTY_NOTICE_PATH = 'public/legal/THIRD-PARTY-NOTICES.md';

export const DDSP_RELEASE_INVENTORY_PATHS = [
    'index.html',
    'package.json',
    'pnpm-lock.yaml',
    TFJS_APACHE_LICENSE_PATH,
    TFJS_NOTICE_PATH,
    MAGENTA_NOTICE_PATH,
    THIRD_PARTY_NOTICE_PATH,
    'vite.config.ts',
    'electron-builder.yml',
    'electron/main.ts',
    'electron/protocol.ts',
    'electron/security.ts',
    'electron/__tests__/webviewSecurity.spec.ts',
    'scripts/electronE2EIsolation.ts',
    'scripts/runElectronE2E.ts',
    'scripts/checkReleaseInventory.ts',
    'scripts/__tests__/checkReleaseInventory.spec.ts',
    'scripts/__tests__/electronE2EIsolation.spec.ts',
    'scripts/__tests__/runElectronE2E.spec.ts',
    'src/infra/release/modelReleaseAdmission.ts',
    'src/modules/BrowserAi/models/BrowserModel.ts',
    'src/modules/BrowserAi/models/DdspArtifactManifest.ts',
    'src/modules/BrowserAi/models/DdspInstrumentCatalog.ts',
    'src/modules/BrowserAi/models/InferenceRequest.ts',
    'src/modules/BrowserAi/models/ModelDownloadProgress.ts',
    'src/modules/BrowserAi/models/ModelStorageWorkerProtocol.ts',
    'src/modules/BrowserAi/models/RenderProgress.ts',
    'src/modules/BrowserAi/models/StorageStatus.ts',
    'src/modules/BrowserAi/presentations/views/ModelManagerPanel.tsx',
    'src/modules/BrowserAi/repositories/abortWritable.ts',
    'src/modules/BrowserAi/repositories/computeRenderCacheKey.ts',
    'src/modules/BrowserAi/repositories/ddspModelStorage.ts',
    'src/modules/BrowserAi/repositories/getStorageStatus.ts',
    'src/modules/BrowserAi/repositories/inferenceWorkerBridge.ts',
    'src/modules/BrowserAi/repositories/isNotFoundError.ts',
    'src/modules/BrowserAi/repositories/modelDownloadManager.ts',
    'src/modules/BrowserAi/repositories/modelStorageWorkerBridge.ts',
    'src/modules/BrowserAi/repositories/readRenderCache.ts',
    'src/modules/BrowserAi/repositories/sha256ArrayBuffer.ts',
    'src/modules/BrowserAi/repositories/storageConstants.ts',
    'src/modules/BrowserAi/repositories/toOpfsPath.ts',
    'src/modules/BrowserAi/repositories/withDdspInstrumentLock.ts',
    'src/modules/BrowserAi/repositories/writeRenderCache.ts',
    'src/modules/BrowserAi/services/audioResampler.ts',
    'src/modules/BrowserAi/services/midiToDdspInput.ts',
    'src/modules/BrowserAi/stores/inferenceProgressStore.ts',
    'src/modules/BrowserAi/stores/modelRegistryStore.ts',
    'src/modules/BrowserAi/stores/renderQueueStore.ts',
    'src/modules/BrowserAi/useCases/cancelRender.ts',
    'src/modules/BrowserAi/useCases/downloadDdspInstrument.ts',
    'src/modules/BrowserAi/useCases/index.ts',
    'src/modules/BrowserAi/useCases/initBrowserAi.ts',
    'src/modules/BrowserAi/useCases/isDdspInstrumentId.ts',
    'src/modules/BrowserAi/useCases/removeDdspInstrument.ts',
    'src/modules/BrowserAi/useCases/renderDdspInstrument.ts',
    'src/modules/BrowserAi/workers/modelStorageWorker.ts',
    'src/modules/BrowserAi/workers/modelStorageWorkerRuntime.ts',
    'src/modules/BrowserAi/workers/tfjsInferenceWorker.ts',
    'src/modules/BrowserAi/workers/tfjsInferenceWorkerRuntime.ts',
    'src/modules/Preferences/presentations/views/preferences/AiSection.tsx',
    'src/modules/Transport/useCases/index.ts',
    'src/modules/Transport/useCases/secondsBetweenBeats.ts',
    'src/modules/TimelineEditor/presentations/views/Inspector/ClipMidiAiSection.tsx',
    'tests/e2e/ddspProductionCspElectron.playwright.config.ts',
    'tests/e2e/ddspProductionCspElectron.spec.ts',
    'tests/e2e/ddspRender.playwright.config.ts',
    'tests/e2e/ddspRender.spec.ts',
    'tests/e2e/ddspRenderElectron.playwright.config.ts',
    'tests/e2e/ddspRenderElectron.spec.ts',
    'tests/e2e/ddspRenderProbe.html',
    'tests/e2e/ddspRenderProbe.ts',
    'tests/e2e/modelManagerAdmission.spec.ts',
] as const;

export const DDSP_RELEASE_INVENTORY_CONTRACT = {
    kind: 'model-stack',
    paths: [...DDSP_RELEASE_INVENTORY_PATHS],
    sources: [
        'https://github.com/magenta/magenta-js/blob/0692eb2b79681f062c6b6dd53a0361967f298caa/music/checkpoints/README.md',
        'https://github.com/magenta/magenta-js/blob/0692eb2b79681f062c6b6dd53a0361967f298caa/music/src/ddsp/ddsp.ts',
        'https://github.com/magenta/magenta-js/blob/0692eb2b79681f062c6b6dd53a0361967f298caa/music/src/ddsp/model.ts',
        'https://github.com/magenta/magenta-js/blob/0692eb2b79681f062c6b6dd53a0361967f298caa/music/src/ddsp/constants.ts',
        'https://github.com/magenta/magenta-js/blob/0692eb2b79681f062c6b6dd53a0361967f298caa/music/src/ddsp/audio_utils.ts',
        'https://github.com/magenta/magenta-js/blob/0692eb2b79681f062c6b6dd53a0361967f298caa/LICENSE',
        'https://storage.googleapis.com/magentadata/js/checkpoints/ddsp',
        'https://github.com/tensorflow/tfjs/blob/e5d5e9371ed1fd0a4df6d7cd0b947d2a820cefd7/LICENSE',
        'https://github.com/tensorflow/tfjs/blob/e5d5e9371ed1fd0a4df6d7cd0b947d2a820cefd7/tfjs/package.json',
        'https://github.com/tensorflow/tfjs/blob/e5d5e9371ed1fd0a4df6d7cd0b947d2a820cefd7/tfjs-backend-webgpu/package.json',
        'package.json',
        'pnpm-lock.yaml',
    ],
    revisions: [
        'magenta-js 0692eb2b79681f062c6b6dd53a0361967f298caa music/checkpoints/README.md',
        'magenta-js DDSP code 0692eb2b79681f062c6b6dd53a0361967f298caa',
        'magenta-js-ddsp-2020-01-05',
        'TensorFlow.js tfjs-v4.22.0 e5d5e9371ed1fd0a4df6d7cd0b947d2a820cefd7',
        '@tensorflow/tfjs 4.22.0',
        '@tensorflow/tfjs-backend-webgpu 4.22.0',
    ],
    digests: [
        'sha256:4c4cc99e186fb101442c38fd0ed869c7911feb81a03113c092f48a7f07f89888:381158:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/violin/model.json',
        'sha256:e2df331d82cf56ed58c202c7af545b305f6794c655897dfc45535620a0d2fc12:3888160:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/violin/group1-shard1of1.bin',
        'sha256:9cfae64cf6e36007192a479f6f74e26356ed0e6d4521d242498bcb4e04723269:171:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/violin/settings.json',
        'sha256:81a2187d58ca5d02e30b755aaa9abed171b0269a7cf2207f445a177af9add434:381158:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/flute/model.json',
        'sha256:1ce83914040927c5713ad80131c9bfa7eed960b696ca8f17176392b7287ad745:3888160:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/flute/group1-shard1of1.bin',
        'sha256:d4b754db5cd6fe4937de3bd205c4db1aa6d824b8a35571f62047b7a546628fc3:171:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/flute/settings.json',
        'sha256:20cf69198fc87decefce850fc5315562f2d72c01da89cd16581dc868f1daa5b5:381158:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/trumpet/model.json',
        'sha256:4785eff16aef6d5e620f70866b865e3cb6462f0670edeeb9711603a354170538:3888160:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/trumpet/group1-shard1of1.bin',
        'sha256:60e26d8fd06c963b2828c112f70d4e5667fc9cd328fe6a65977fe839d6393e93:173:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/trumpet/settings.json',
        'sha256:1b334b0639c2dd7f19e904a977339c7e4b53fe7fde4f56cc7c9797c99789787e:381158:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/tenor_saxophone/model.json',
        'sha256:e4f9c5703a80cb874bca35818b22eb86d7f02ade3098974b47c6d248e6e57f0d:3888160:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/tenor_saxophone/group1-shard1of1.bin',
        'sha256:4632398ffae90dc12dccf6bb9480102c6947f5c5eb5829415108f25d8cf0a7fe:171:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/tenor_saxophone/settings.json',
    ],
    licenses: [
        'permission:Magenta-checkpoints-README-direct-application-loading-or-self-hosting',
        'unverified:checkpoint-weights-no-license-grant-established',
        'Apache-2.0:magenta-js-ddsp-code',
        'Apache-2.0:@tensorflow/tfjs',
        'Apache-2.0:@tensorflow/tfjs-backend-webgpu',
        `Apache-2.0-license-text:${TFJS_APACHE_LICENSE_PATH}`,
        `attribution-notice:${MAGENTA_NOTICE_PATH}`,
        `attribution-notice:${TFJS_NOTICE_PATH}`,
    ],
    evidence: [
        'The immutable Magenta checkpoint README permits direct application loading and downloading/self-hosting for the four named DDSP checkpoint directories.',
        'The manifest pins the exact URL, byte count, and SHA-256 of all twelve runtime-downloaded artifacts before OPFS readiness.',
        'Worker, bridge, storage, render, UI, CSP, browser/Electron probe, build, and dependency paths are classified as one execution surface.',
        'The immutable Magenta.js DDSP source headers and repository license establish Apache-2.0 for the adapted code basis, including model.ts Roll registration.',
        'The TensorFlow.js 4.22.0 package metadata and unmodified Apache-2.0 license are pinned to upstream commit e5d5e9371ed1fd0a4df6d7cd0b947d2a820cefd7.',
    ],
    obligations: [
        'Do not describe the checkpoint weights as Apache-2.0; the cited checkpoint permission does not establish that license.',
        'Preserve per-file size and SHA-256 admission before readiness or inference.',
        'Keep the Magenta.js copyright, code-basis attribution, modification notice, and Apache-2.0 license with distributed source and desktop builds.',
        'Keep TensorFlow.js Apache-2.0 attribution and notices with distributed source and desktop builds.',
        'Download checkpoint weights at runtime only until redistribution rights are independently established.',
    ],
} as const;

export const REQUIRED_COMPONENT_PATHS: Readonly<Record<string, readonly string[]>> = {
    'ddsp-models': DDSP_RELEASE_INVENTORY_PATHS,
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

type SurfaceContract = Pick<ReleaseSurface, 'kind' | 'paths' | 'sources' | 'revisions' | 'digests' | 'licenses'>;
type TrademarkSurfaceContract = Omit<SurfaceContract, 'paths'>;

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

function fileSha256(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function ddspReleaseInventoryContract(root: string) {
    return {
        ...DDSP_RELEASE_INVENTORY_CONTRACT,
        paths: [...DDSP_RELEASE_INVENTORY_CONTRACT.paths],
        sources: [...DDSP_RELEASE_INVENTORY_CONTRACT.sources],
        revisions: [...DDSP_RELEASE_INVENTORY_CONTRACT.revisions],
        digests: [
            ...DDSP_RELEASE_INVENTORY_CONTRACT.digests,
            ...[TFJS_APACHE_LICENSE_PATH, MAGENTA_NOTICE_PATH, TFJS_NOTICE_PATH, THIRD_PARTY_NOTICE_PATH].map(
                (path) => `sha256:${fileSha256(resolve(root, path))}:${path}`
            ),
        ],
        licenses: [...DDSP_RELEASE_INVENTORY_CONTRACT.licenses],
        evidence: [...DDSP_RELEASE_INVENTORY_CONTRACT.evidence],
        obligations: [...DDSP_RELEASE_INVENTORY_CONTRACT.obligations],
    };
}

export const AUDIO_WORKLET_SOURCES = [
    'public/audio/worklets/native-plugin-bridge-processor.js',
    'public/audio/worklets/sidechain-compressor-processor.js',
] as const;

export function audioWorkletReleaseInventoryContract(root: string): SurfaceContract {
    return {
        kind: 'project-source',
        paths: [...AUDIO_WORKLET_SOURCES],
        sources: [...AUDIO_WORKLET_SOURCES],
        revisions: ['not-applicable:direct-project-source'],
        digests: AUDIO_WORKLET_SOURCES.map((path) => `sha256:${fileSha256(resolve(root, path))}:${path}`),
        licenses: ['pending:OS-10-project-grant'],
    };
}

export function trademarkReleaseInventoryContract(root: string): TrademarkSurfaceContract {
    return {
        kind: 'reference-map',
        sources: [TRADEMARK_NOTICE_PATH, 'current source text'],
        revisions: ['current release text'],
        digests: [`sha256:${fileSha256(resolve(root, TRADEMARK_NOTICE_PATH))}:${TRADEMARK_NOTICE_PATH}`],
        licenses: ['not-applicable:trademark-rights-not-granted'],
    };
}

export function wasmReleaseInventoryContract(root: string, manifest: WasmManifest): SurfaceContract {
    const packages = Object.entries(manifest.packages).sort(([left], [right]) => left.localeCompare(right));
    return {
        kind: 'generated-binary',
        paths: ['public/wasm/**'],
        sources: packages.map(([, entry]) => `${entry.crate}/`),
        revisions: [
            `rust ${manifest.toolchain.rustToolchain}`,
            `wasm-pack ${manifest.toolchain.wasmPack}`,
            `wasm-bindgen ${manifest.toolchain.wasmBindgen}`,
            `wasm-opt ${manifest.toolchain.wasmOpt}`,
            ...packages.map(([id, entry]) => `${id} ${entry.crateSourceHash}`),
        ],
        digests: [`sha256:${fileSha256(resolve(root, 'public/wasm/manifest.json'))}:public/wasm/manifest.json`],
        licenses: ['pending:OS-10-project-grant', 'pending:OS-10-Cargo-dependency-notices'],
    };
}

function assertSurfaceContract(
    surface: ReleaseSurface | undefined,
    expected: Readonly<Record<string, unknown>>,
    label: string
): void {
    for (const [field, value] of Object.entries(expected)) {
        if (JSON.stringify(surface?.[field as keyof ReleaseSurface]) !== JSON.stringify(value)) {
            throw new Error(`${label} release inventory ${field} does not match provenance`);
        }
    }
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
                const allowedPaths = sortedUnique([...mappedPaths, TRADEMARK_NOTICE_PATH]);
                if (!markSurface.paths.includes(TRADEMARK_NOTICE_PATH)) {
                    errors.push(`third-party-marks: required notice missing: ${TRADEMARK_NOTICE_PATH}`);
                }
                errors.push(
                    formatMissing(
                        'third-party-marks: candidate paths missing from surface',
                        mappedPaths.filter((path) => !markSurface.paths.includes(path))
                    )
                );
                errors.push(
                    formatMissing(
                        'third-party-marks: stale surface paths',
                        markSurface.paths.filter((path) => !allowedPaths.includes(path))
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
    execFileSync(process.execPath, [resolve(root, 'scripts/verify-wasm-artifacts.ts')], {
        cwd: root,
        stdio: 'inherit',
    });
    const wasmSurface = inventory.surfaces.find((surface) => surface.id === 'project-wasm');
    assertSurfaceContract(wasmSurface, wasmReleaseInventoryContract(root, wasmArtifacts.readManifest()), 'WASM');
    const workletSurface = inventory.surfaces.find((surface) => surface.id === 'audio-worklet-sources');
    assertSurfaceContract(workletSurface, audioWorkletReleaseInventoryContract(root), 'audio worklet');
    const trademarkSurface = inventory.surfaces.find((surface) => surface.id === 'third-party-marks');
    assertSurfaceContract(trademarkSurface, trademarkReleaseInventoryContract(root), 'trademark');
    const ddspSurface = inventory.surfaces.find((surface) => surface.id === 'ddsp-models');
    assertSurfaceContract(ddspSurface, ddspReleaseInventoryContract(root), 'DDSP');
    checkElectronRuntimeProvenance(root);
    const electronSurface = inventory.surfaces.find((surface) => surface.id === 'desktop-shell');
    for (const [field, expected] of Object.entries(electronReleaseInventoryContract())) {
        if (JSON.stringify(electronSurface?.[field as keyof ReleaseSurface]) !== JSON.stringify(expected)) {
            throw new Error(`Electron release inventory ${field} does not match provenance`);
        }
    }
    checkLgplRuntimeProvenance(root);
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

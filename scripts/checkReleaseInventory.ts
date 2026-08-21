#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DDSP_ARTIFACTS, DDSP_CHECKPOINT_VERSION } from '../src/modules/BrowserAi/models/DdspArtifactManifest.ts';

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

export const OWNER_VISUAL_ASSET_PATHS = [
    'public/favicon.ico',
    'public/icon-192.png',
    'public/icon-transparent.png',
    'public/icon.png',
    'public/logo-parts/**',
    'sourdaw.png',
    'build/icons/**',
] as const;

export const DDSP_TFJS_RUNTIME_PATHS = [
    'package.json',
    'pnpm-lock.yaml',
    'public/legal/Apache-2.0.txt',
    'public/legal/Magenta.js-NOTICE.txt',
    'public/legal/TensorFlow.js-NOTICE.txt',
    'public/legal/seedrandom-MIT.txt',
    'public/legal/THIRD-PARTY-NOTICES.md',
    'src/modules/BrowserAi/models/InferenceRequest.ts',
    'src/modules/BrowserAi/repositories/inferenceWorkerBridge.ts',
    'src/modules/BrowserAi/services/computeDdspSessionKey.ts',
    'src/modules/BrowserAi/workers/tfjsInferenceWorker.ts',
    'src/modules/BrowserAi/workers/tfjsInferenceWorkerRuntime.ts',
] as const;

const DDSP_TFJS_LEGAL_PATHS = [
    'public/legal/Apache-2.0.txt',
    'public/legal/Magenta.js-NOTICE.txt',
    'public/legal/TensorFlow.js-NOTICE.txt',
    'public/legal/seedrandom-MIT.txt',
    'public/legal/THIRD-PARTY-NOTICES.md',
] as const;

export const DDSP_ADMISSION_DECISION_PATH = '.agents/decisions/0035-admit-direct-magenta-ddsp-checkpoint-downloads.md';

export const DDSP_MODEL_PATHS = [
    DDSP_ADMISSION_DECISION_PATH,
    'electron/protocol.ts',
    'public/legal/THIRD-PARTY-NOTICES.md',
    'scripts/checkReleaseInventory.ts',
    'src/infra/release/modelReleaseAdmission.ts',
    'src/modules/BrowserAi/models/DdspArtifactManifest.ts',
    'src/modules/BrowserAi/models/DdspInstrumentCatalog.ts',
    'src/modules/BrowserAi/presentations/views/ModelManagerPanel.tsx',
    'src/modules/BrowserAi/repositories/modelDownloadManager.ts',
    'src/modules/BrowserAi/repositories/publishDdspInstrumentGeneration.ts',
    'src/modules/BrowserAi/useCases/downloadDdspInstrument.ts',
    'src/modules/BrowserAi/useCases/downloadModel.ts',
    'src/modules/BrowserAi/useCases/initBrowserAi.ts',
    'src/modules/BrowserAi/useCases/removeModel.ts',
    'src/modules/BrowserAi/useCases/renderDdspInstrument.ts',
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

export type ReleaseInventoryCheckReceipt = {
    validatedSurfaceIds: string[];
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

function directorySha256(root: string, directory: string): string {
    const absoluteRoot = resolve(root, directory);
    const files: string[] = [];
    const visit = (path: string): void => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const child = resolve(path, entry.name);
            if (entry.isDirectory()) {
                visit(child);
            } else if (entry.isFile()) {
                files.push(child);
            }
        }
    };
    visit(absoluteRoot);
    const hash = createHash('sha256');
    for (const file of files.sort()) {
        hash.update(relative(absoluteRoot, file).replaceAll('\\', '/'));
        hash.update('\0');
        hash.update(readFileSync(file));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function trackedFiles(root: string, pathspecs: readonly string[]): string[] {
    return execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], {
        cwd: root,
        encoding: 'utf8',
    })
        .split('\0')
        .filter(Boolean)
        .sort();
}

function trackedFilesSha256(root: string, files: readonly string[]): string {
    const hash = createHash('sha256');
    for (const file of files) {
        if (!existsSync(resolve(root, file))) {
            throw new Error(`Grand Boule preserved source is missing: ${file}`);
        }
        hash.update(file);
        hash.update('\0');
        hash.update(readFileSync(resolve(root, file)));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function trackedSetSha256(root: string, pathspecs: readonly string[]): string {
    const files = trackedFiles(root, pathspecs);
    if (files.length === 0) {
        throw new Error(`Grand Boule preserved source boundary has no tracked files: ${pathspecs.join(', ')}`);
    }
    return trackedFilesSha256(root, files);
}

export const AUDIO_WORKLET_SOURCES = [
    'public/audio/worklets/native-plugin-bridge-processor.js',
    'public/audio/worklets/sidechain-compressor-processor.js',
] as const;

const PUBLIC_WASM_ROOT = 'public/wasm';
const WASM_MANIFEST_PATH = `${PUBLIC_WASM_ROOT}/manifest.json`;
const AUDIO_ENGINE_WASM_MIRROR_ROOT = 'src/modules/AudioEngine/wasm';
const AUDIO_ENGINE_WASM_MIRROR_TEST_SOURCES = new Set([
    `${AUDIO_ENGINE_WASM_MIRROR_ROOT}/__tests__/dawDspCrustGates.spec.ts`,
    `${AUDIO_ENGINE_WASM_MIRROR_ROOT}/__tests__/dawDspCrustOversampling.spec.ts`,
    `${AUDIO_ENGINE_WASM_MIRROR_ROOT}/__tests__/dawDspFermenterAutomationOrdinals.spec.ts`,
    `${AUDIO_ENGINE_WASM_MIRROR_ROOT}/__tests__/dawDspGrinderAutomationLayout.spec.ts`,
    `${AUDIO_ENGINE_WASM_MIRROR_ROOT}/__tests__/dawDspKneadPitchControls.spec.ts`,
    `${AUDIO_ENGINE_WASM_MIRROR_ROOT}/__tests__/dawDspToasterAutomation.spec.ts`,
]);

export type DistributedWasmArtifactCensus = {
    textArtifacts: string[];
    wasmArtifacts: string[];
};

function namesGrandBoule(value: string): boolean {
    return value
        .replaceAll(/[^A-Za-z0-9]/g, '')
        .toLowerCase()
        .includes('grandboule');
}

function filesRecursively(root: string, directory: string): string[] {
    const absoluteDirectory = resolve(root, directory);
    const files: string[] = [];
    const visit = (path: string): void => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const child = resolve(path, entry.name);
            if (entry.isDirectory()) {
                visit(child);
            } else if (entry.isFile()) {
                files.push(relative(root, child).replaceAll('\\', '/'));
            } else {
                throw new Error(`distributed WASM artifact census cannot inspect ${relative(root, child)}`);
            }
        }
    };
    visit(absoluteDirectory);
    return files.sort();
}

function assertExactArtifactCensus(label: string, actual: string[], expected: string[]): void {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const unexpected = actual.filter((path) => !expectedSet.has(path));
    const missing = expected.filter((path) => !actualSet.has(path));
    if (unexpected.length > 0) {
        throw new Error(`${label} has unexpected artifact ${unexpected[0]}`);
    }
    if (missing.length > 0) {
        throw new Error(`${label} is missing manifest artifact ${missing[0]}`);
    }
}

function readWasmManifest(root: string): WasmManifest {
    return JSON.parse(readFileSync(resolve(root, WASM_MANIFEST_PATH), 'utf8')) as WasmManifest;
}

function isMirrorSourceOnly(path: string): boolean {
    return path === `${AUDIO_ENGINE_WASM_MIRROR_ROOT}/.gitignore` || AUDIO_ENGINE_WASM_MIRROR_TEST_SOURCES.has(path);
}

function assertManifestDistributionContract(manifest: WasmManifest): void {
    const expectedPackages = wasmArtifacts.packages.map(({ id }) => id).sort();
    const actualPackages = Object.keys(manifest.packages).sort();
    const unexpectedPackage = actualPackages.find((id) => !expectedPackages.includes(id));
    if (unexpectedPackage !== undefined) {
        throw new Error(`WASM manifest has unexpected package ${unexpectedPackage}`);
    }
    const missingPackage = expectedPackages.find((id) => !actualPackages.includes(id));
    if (missingPackage !== undefined) {
        throw new Error(`WASM manifest is missing package ${missingPackage}`);
    }

    for (const spec of wasmArtifacts.packages) {
        const entry = manifest.packages[spec.id];
        if (entry === undefined) {
            throw new Error(`WASM manifest is missing package ${spec.id}`);
        }
        if (entry.crate !== spec.crateDir) {
            throw new Error(`WASM manifest package ${spec.id} has unexpected crate path ${entry.crate}`);
        }

        const expectedArtifacts = [...spec.artifacts].sort();
        const actualArtifacts = Object.keys(entry.artifacts).sort();
        const unexpectedArtifact = actualArtifacts.find((path) => !expectedArtifacts.includes(path));
        if (unexpectedArtifact !== undefined) {
            throw new Error(`WASM manifest package ${spec.id} has unexpected artifact ${unexpectedArtifact}`);
        }
        const missingArtifact = expectedArtifacts.find((path) => !actualArtifacts.includes(path));
        if (missingArtifact !== undefined) {
            throw new Error(`WASM manifest package ${spec.id} is missing artifact ${missingArtifact}`);
        }
    }
}

export function distributedWasmArtifactCensus(root: string): DistributedWasmArtifactCensus {
    const manifest = readWasmManifest(root);
    assertManifestDistributionContract(manifest);

    const artifacts = Object.values(manifest.packages)
        .flatMap((entry) => Object.keys(entry.artifacts))
        .sort();
    const expectedPublic = artifacts.filter((path) => path.startsWith(`${PUBLIC_WASM_ROOT}/`));
    const expectedCompleteMirror = artifacts.filter((path) => path.startsWith(`${AUDIO_ENGINE_WASM_MIRROR_ROOT}/`));

    assertExactArtifactCensus(
        'distributed public WASM tree',
        filesRecursively(root, PUBLIC_WASM_ROOT),
        [...expectedPublic, WASM_MANIFEST_PATH].sort()
    );
    assertExactArtifactCensus(
        'distributed AudioEngine WASM mirror',
        filesRecursively(root, AUDIO_ENGINE_WASM_MIRROR_ROOT).filter((path) => !isMirrorSourceOnly(path)),
        expectedCompleteMirror
    );

    return {
        textArtifacts: artifacts.filter((path) => !path.endsWith('.wasm')),
        wasmArtifacts: artifacts.filter((path) => path.endsWith('.wasm')),
    };
}

export function assertGrandBouleRustWasmBoundary(root: string): void {
    const source = readFileSync(resolve(root, 'crates/daw-dsp/src/lib.rs'), 'utf8');
    const gatedModule =
        /#\[cfg\s*\(\s*not\s*\(\s*target_arch\s*=\s*"wasm32"\s*\)\s*\)\s*\]\s*pub\s+mod\s+grand_boule\s*;/u;
    const declarations = source.match(/pub\s+mod\s+grand_boule\s*;/gu) ?? [];
    if (declarations.length !== 1 || !gatedModule.test(source)) {
        throw new Error('Grand Boule must be gated out of the wasm32 crate graph at crates/daw-dsp/src/lib.rs');
    }
}

export function assertGrandBouleWithheldFromWasm(root: string): void {
    const census = distributedWasmArtifactCensus(root);
    for (const path of census.textArtifacts) {
        if (namesGrandBoule(readFileSync(resolve(root, path), 'utf8'))) {
            throw new Error(`Grand Boule must not be exposed by distributed daw-dsp WASM surface ${path}`);
        }
    }

    for (const path of census.wasmArtifacts) {
        const module = new WebAssembly.Module(readFileSync(resolve(root, path)));
        const forbiddenExport = WebAssembly.Module.exports(module).find(({ name }) => namesGrandBoule(name));
        if (forbiddenExport !== undefined) {
            throw new Error(
                `Grand Boule must not be exposed by distributed daw-dsp WASM binary export ${path}:${forbiddenExport.name}`
            );
        }
    }
}

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

type GrandBoulePreservationBoundary = {
    path: string;
    gitPathspec: string;
    digestLabel: string;
};

export const GRAND_BOULE_PRESERVATION_REGISTRY = {
    kind: 'patent-directed-component',
    retention: 'defer-behind-admission',
    owner: 'OS-05',
    releaseModes: ['source', 'web', 'desktop'],
    productSurfaces: ['Preserved Grand Boule source and project schema'],
    boundaries: [
        {
            path: 'crates/daw-dsp/src/grand_boule/**',
            gitPathspec: 'crates/daw-dsp/src/grand_boule',
            digestLabel: 'grand-boule-native-rust',
        },
        {
            path: 'src/modules/GrandBoule/**',
            gitPathspec: 'src/modules/GrandBoule',
            digestLabel: 'grand-boule-product-module',
        },
        {
            path: 'src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts',
            gitPathspec: 'src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts',
            digestLabel: 'grand-boule-product-descriptor',
        },
        {
            path: 'src/infra/release/deviceReleaseAdmission.ts',
            gitPathspec: 'src/infra/release/deviceReleaseAdmission.ts',
            digestLabel: 'grand-boule-release-admission',
        },
        {
            path: 'src/modules/AudioEngine/engine/GrandBouleNode.ts',
            gitPathspec: 'src/modules/AudioEngine/engine/GrandBouleNode.ts',
            digestLabel: 'grand-boule-node-host',
        },
        {
            path: 'src/modules/AudioEngine/models/GrandBouleRingProtocol.ts',
            gitPathspec: 'src/modules/AudioEngine/models/GrandBouleRingProtocol.ts',
            digestLabel: 'grand-boule-ring-protocol',
        },
        {
            path: 'src/modules/AudioEngine/workers/grandBouleEngineWorker.ts',
            gitPathspec: 'src/modules/AudioEngine/workers/grandBouleEngineWorker.ts',
            digestLabel: 'grand-boule-worker-host',
        },
        {
            path: 'src/modules/AudioEngine/worklets/grandBoule*.ts',
            gitPathspec: ':(glob)src/modules/AudioEngine/worklets/grandBoule*.ts',
            digestLabel: 'grand-boule-worklet-hosts',
        },
    ] satisfies readonly GrandBoulePreservationBoundary[],
} as const;

export function grandBouleReleaseInventoryContract(
    root: string
): Pick<
    ReleaseSurface,
    | 'kind'
    | 'retention'
    | 'owner'
    | 'releaseModes'
    | 'paths'
    | 'sources'
    | 'revisions'
    | 'digests'
    | 'licenses'
    | 'productSurfaces'
> {
    return {
        kind: GRAND_BOULE_PRESERVATION_REGISTRY.kind,
        retention: GRAND_BOULE_PRESERVATION_REGISTRY.retention,
        owner: GRAND_BOULE_PRESERVATION_REGISTRY.owner,
        releaseModes: [...GRAND_BOULE_PRESERVATION_REGISTRY.releaseModes],
        paths: GRAND_BOULE_PRESERVATION_REGISTRY.boundaries.map(({ path }) => path),
        sources: [
            'crates/daw-dsp/src/grand_boule/',
            'src/modules/GrandBoule/',
            'src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts',
            'src/infra/release/deviceReleaseAdmission.ts',
            'retained Grand Boule AudioEngine host, worker, and worklet source',
            'active patent sources recorded in the readiness audit',
        ],
        revisions: [
            'current tracked Rust source',
            'current tracked Grand Boule product source',
            'current tracked Grand Boule descriptor and release-admission boundary',
            'current tracked AudioEngine host boundary',
        ],
        digests: GRAND_BOULE_PRESERVATION_REGISTRY.boundaries.map(
            ({ gitPathspec, digestLabel }) =>
                `tracked-set-sha256:${trackedSetSha256(root, [gitPathspec])}:${digestLabel}`
        ),
        licenses: ['pending:OS-10-project-grant', 'unverified:HAL-parameter-source-reuse-terms'],
        productSurfaces: [...GRAND_BOULE_PRESERVATION_REGISTRY.productSurfaces],
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

export function ownerVisualAssetReleaseInventoryContract(root: string): SurfaceContract {
    const files = [
        'public/favicon.ico',
        'public/icon-192.png',
        'public/icon-transparent.png',
        'public/icon.png',
        'sourdaw.png',
    ];
    return {
        kind: 'owner-created-asset',
        paths: [...OWNER_VISUAL_ASSET_PATHS],
        sources: ['owner attestation: Jose Costa, 2026-08-21', 'public/icon.png'],
        revisions: [
            'git:130452d6d989b0f02ca81c36c2cf25178d6da362:public/icon.png',
            'git:ddee040560bbdf5f954b8970d8e2fe736cd6d9b8:public/logo-parts',
            'derived renditions',
        ],
        digests: [
            ...files.map((path) => `sha256:${fileSha256(resolve(root, path))}:${path}`),
            `tree-sha256:${directorySha256(root, 'public/logo-parts')}:public/logo-parts`,
            `tree-sha256:${directorySha256(root, 'build/icons')}:build/icons`,
        ],
        licenses: ['owner-created:pending-OS-10-project-license'],
    };
}

/** Exact distributed code and notice closure for the DDSP worker runtime. */
export function ddspTfjsRuntimeReleaseInventoryContract(root: string): Partial<ReleaseSurface> {
    return {
        kind: 'runtime-library',
        retention: 'keep-with-obligations',
        owner: 'OS-04',
        releaseModes: ['source', 'web', 'desktop'],
        paths: [...DDSP_TFJS_RUNTIME_PATHS],
        sources: [
            'git:github.com/tensorflow/tfjs@e5d5e9371ed1fd0a4df6d7cd0b947d2a820cefd7',
            'git:github.com/dcodeIO/long.js@941c5c62471168b5d18153755c2a7b38d2560e58',
            'git:github.com/davidbau/seedrandom@4460ad325a0a15273a211e509f03ae0beb99511a',
            'git:github.com/magenta/magenta-js@0692eb2b79681f062c6b6dd53a0361967f298caa:music/src/ddsp/model.ts',
            'package.json',
            'pnpm-lock.yaml',
        ],
        revisions: [
            '@tensorflow/tfjs-core 4.22.0',
            '@tensorflow/tfjs-converter 4.22.0',
            '@tensorflow/tfjs-backend-webgpu 4.22.0',
            '@tensorflow/tfjs-backend-cpu 4.22.0 shared helpers only',
            'long 4.0.0',
            'seedrandom 3.0.5',
            'Magenta.js 0692eb2b79681f062c6b6dd53a0361967f298caa Roll operation',
            'runtime tfjs-4.22.0-webgpu-raw-v1',
        ],
        digests: [
            'npm-integrity:sha512-LEkOyzbknKFoWUwfkr59vSB68DMJ4cjwwHgicXN0DUi3a0Vh1Er3JQqCI1Hl86GGZQvY8ezVrtDIvqR1ZFW55A==:@tensorflow/tfjs-core@4.22.0',
            'npm-integrity:sha512-PT43MGlnzIo+YfbsjM79Lxk9lOq6uUwZuCc8rrp0hfpLjF6Jv8jS84u2jFb+WpUeuF4K33ZDNx8CjiYrGQ2trQ==:@tensorflow/tfjs-converter@4.22.0',
            'npm-integrity:sha512-lvIc7Af4Tl2BCdYp43iQmSCRq3asaKT0q2xaErphXiUZ+jqeB0bQa0ZvQys1Xatvto0U4/c90DVsHPfvkn5ftg==:@tensorflow/tfjs-backend-webgpu@4.22.0',
            'npm-integrity:sha512-1u0FmuLGuRAi8D2c3cocHTASGXOmHc/4OvoVDENJayjYkS119fcTcQf4iHrtLthWyDIPy3JiPhRrZQC9EwnhLw==:@tensorflow/tfjs-backend-cpu@4.22.0',
            'npm-integrity:sha512-XsP+KhQif4bjX1kbuSiySJFNAehNxgLb6hPRGJ9QsUr8ajHkuXGdrHmFUTUUXhDwVX2R5bY4JNZEwbUiMhV+MA==:long@4.0.0',
            'npm-integrity:sha512-8OwmbklUNzwezjGInmZ+2clQmExQPvomqjL7LFqOYqtmuxRgQYqOD3mHaU+MvZn5FLUeVxVfQjwLZW/n/JFuqg==:seedrandom@3.0.5',
            ...DDSP_TFJS_LEGAL_PATHS.map((path) => `sha256:${fileSha256(resolve(root, path))}:${path}`),
        ],
        licenses: [
            'Apache-2.0:TensorFlow.js',
            'Apache-2.0:long',
            'Apache-2.0:Magenta.js-Roll-adaptation',
            'MIT:seedrandom-and-Alea',
        ],
        productSurfaces: ['browser and desktop DDSP hardware-WebGPU worker runtime'],
        evidence: [
            'Exact package versions and npm integrity digests are pinned in the install graph.',
            'The release validator binds the complete runtime and legal-file closure.',
            'The runtime accepts only locally verified checkpoint artifact transfers and registers no CPU or WebGL fallback.',
        ],
        obligations: [
            'Keep the Apache-2.0 and MIT texts and exact component notices with every distribution.',
            'Do not characterize separately downloaded DDSP checkpoint artifacts under these runtime licenses.',
        ],
    };
}

/** Exact admitted identity, delivery boundary, and legal status of the Magenta DDSP checkpoints. */
export function ddspModelsReleaseInventoryContract(root: string): Partial<ReleaseSurface> {
    const artifacts = Object.values(DDSP_ARTIFACTS).flat();

    return {
        kind: 'model-stack',
        retention: 'keep-with-obligations',
        owner: 'OS-04',
        releaseModes: ['web', 'desktop'],
        paths: [...DDSP_MODEL_PATHS],
        sources: [
            'https://raw.githubusercontent.com/magenta/magenta-js/0692eb2b79681f062c6b6dd53a0361967f298caa/music/checkpoints/README.md',
            'https://raw.githubusercontent.com/magenta/magenta-js/0692eb2b79681f062c6b6dd53a0361967f298caa/music/src/ddsp/model.ts',
            'https://storage.googleapis.com/magentadata/js/checkpoints/ddsp',
            'src/modules/BrowserAi/models/DdspArtifactManifest.ts',
            DDSP_ADMISSION_DECISION_PATH,
        ],
        revisions: [
            DDSP_CHECKPOINT_VERSION,
            'Magenta.js 0692eb2b79681f062c6b6dd53a0361967f298caa',
            `${artifacts.length} exact artifacts`,
        ],
        digests: [
            `sha256:${fileSha256(resolve(root, DDSP_ADMISSION_DECISION_PATH))}:${DDSP_ADMISSION_DECISION_PATH}`,
            `sha256:${fileSha256(resolve(root, 'electron/protocol.ts'))}:electron/protocol.ts`,
            `sha256:${fileSha256(resolve(root, 'src/modules/BrowserAi/models/DdspArtifactManifest.ts'))}:src/modules/BrowserAi/models/DdspArtifactManifest.ts`,
            `sha256:${fileSha256(resolve(root, 'public/legal/THIRD-PARTY-NOTICES.md'))}:public/legal/THIRD-PARTY-NOTICES.md`,
            ...artifacts.map(({ sha256, sizeBytes, url }) => `sha256:${sha256}:bytes:${sizeBytes}:${url}`),
        ],
        licenses: ['unverified:exact-GCS-checkpoint-artifacts'],
        productSurfaces: ['explicit browser and desktop downloads of four pinned Magenta DDSP instruments'],
        evidence: [
            'DdspArtifactManifest pins the exact URL, byte size, and SHA-256 for all twelve admitted artifacts.',
            'Each user-requested direct Magenta download is staged and verified before its local generation is published or used.',
            'Sourdaw does not bundle or redistribute the checkpoint bytes.',
        ],
        obligations: [
            'Keep the checkpoint license explicitly unverified; runtime licenses and notices do not cover the weights.',
            'Keep all checkpoint bytes out of Sourdaw distributions and fetch only the admitted identities directly from Magenta until issue #2595 is resolved.',
            'Set MODEL_RELEASE_ADMISSION.ddsp to false if exact identity, verification, or delivery-boundary evidence stops holding.',
        ],
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
    surface: Partial<ReleaseSurface> | undefined,
    expected: Partial<ReleaseSurface>,
    label: string
): void {
    for (const [field, value] of Object.entries(expected)) {
        if (JSON.stringify(surface?.[field as keyof ReleaseSurface]) !== JSON.stringify(value)) {
            throw new Error(`${label} release inventory ${field} does not match provenance`);
        }
    }
}

export function assertDdspModelsReleaseInventory(root: string, surface: Partial<ReleaseSurface> | undefined): void {
    assertSurfaceContract(surface, ddspModelsReleaseInventoryContract(root), 'DDSP models');
}

export function assertGrandBouleReleaseInventory(root: string, surface: Partial<ReleaseSurface> | undefined): void {
    assertSurfaceContract(surface, grandBouleReleaseInventoryContract(root), 'Grand Boule');
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
    if (rule.endsWith('/**')) {
        const directory = rule.slice(0, -3);
        return path === directory || path.startsWith(`${directory}/`);
    }
    if (!rule.includes('*')) {
        return rule === path;
    }
    const expression = rule.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*');
    return new RegExp(`^${expression}$`, 'u').test(path);
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

export function checkReleaseInventory(root: string): ReleaseInventoryCheckReceipt {
    const inventoryPath = resolve(root, 'release/open-source-inventory.json');
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as ReleaseInventory;
    const snapshot = loadRepositorySnapshot(root, inventory);
    const errors = validateReleaseInventory(inventory, snapshot, REQUIRED_MARKS, REQUIRED_COMPONENT_PATHS);
    if (errors.length > 0) {
        throw new Error(errors.join('\n\n'));
    }
    const validatedSurfaceIds: string[] = [];
    const validateSurface = (surfaceId: string, validate: () => void): void => {
        validate();
        validatedSurfaceIds.push(surfaceId);
    };
    execFileSync(process.execPath, [resolve(root, 'scripts/verify-wasm-artifacts.ts')], {
        cwd: root,
        stdio: 'inherit',
    });
    assertGrandBouleRustWasmBoundary(root);
    assertGrandBouleWithheldFromWasm(root);
    const wasmSurface = inventory.surfaces.find((surface) => surface.id === 'project-wasm');
    validateSurface('project-wasm', () =>
        assertSurfaceContract(wasmSurface, wasmReleaseInventoryContract(root, wasmArtifacts.readManifest()), 'WASM')
    );
    const grandBouleSurface = inventory.surfaces.find((surface) => surface.id === 'grand-boule');
    validateSurface('grand-boule', () => assertGrandBouleReleaseInventory(root, grandBouleSurface));
    const workletSurface = inventory.surfaces.find((surface) => surface.id === 'audio-worklet-sources');
    validateSurface('audio-worklet-sources', () =>
        assertSurfaceContract(workletSurface, audioWorkletReleaseInventoryContract(root), 'audio worklet')
    );
    const trademarkSurface = inventory.surfaces.find((surface) => surface.id === 'third-party-marks');
    validateSurface('third-party-marks', () =>
        assertSurfaceContract(trademarkSurface, trademarkReleaseInventoryContract(root), 'trademark')
    );
    const ownerVisualAssetSurface = inventory.surfaces.find((surface) => surface.id === 'owner-visual-assets');
    validateSurface('owner-visual-assets', () =>
        assertSurfaceContract(
            ownerVisualAssetSurface,
            ownerVisualAssetReleaseInventoryContract(root),
            'owner visual asset'
        )
    );
    const ddspTfjsRuntimeSurface = inventory.surfaces.find((surface) => surface.id === 'ddsp-tfjs-runtime');
    validateSurface('ddsp-tfjs-runtime', () =>
        assertSurfaceContract(
            ddspTfjsRuntimeSurface,
            ddspTfjsRuntimeReleaseInventoryContract(root),
            'DDSP TF.js runtime'
        )
    );
    const ddspModelsSurface = inventory.surfaces.find((surface) => surface.id === 'ddsp-models');
    validateSurface('ddsp-models', () => assertDdspModelsReleaseInventory(root, ddspModelsSurface));
    checkElectronRuntimeProvenance(root);
    const electronSurface = inventory.surfaces.find((surface) => surface.id === 'desktop-shell');
    for (const [field, expected] of Object.entries(electronReleaseInventoryContract())) {
        if (JSON.stringify(electronSurface?.[field as keyof ReleaseSurface]) !== JSON.stringify(expected)) {
            throw new Error(`Electron release inventory ${field} does not match provenance`);
        }
    }
    validatedSurfaceIds.push('desktop-shell');
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
    validatedSurfaceIds.push('levain-sample-bank');
    process.stdout.write(
        `release inventory valid: ${String(inventory.surfaces.length)} surfaces, ${String(snapshot.releaseFiles.length)} files, ${String(snapshot.externalReferences.length)} external references, ${String(levain.samples.length)} Levain samples, ${String(levain.generatedFiles.length)} generated Levain files\n`
    );
    return { validatedSurfaceIds };
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    checkReleaseInventory(resolve(fileURLToPath(new URL('..', import.meta.url))));
}

#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, posix, relative, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertGeneratedRegionMatches } from '../crates/daw-dsp/benches/wasm/renderTable.mjs';
import { DDSP_ARTIFACTS, DDSP_CHECKPOINT_VERSION } from '../src/modules/BrowserAi/models/DdspArtifactManifest.ts';

import { checkElectronRuntimeProvenance, electronReleaseInventoryContract } from './checkElectronRuntimeProvenance.ts';
import { checkLevainProvenance } from './checkLevainProvenance.ts';
import { checkLgplRuntimeProvenance } from './checkLgplRuntimeProvenance.ts';
import { checkProjectLicense } from './checkProjectLicense.ts';
import { DEPENDENCY_LICENSE_REPORT_PATH } from './dependencyLicenseReport.ts';
import { parseJsonWithUniqueKeys } from './strictJson.ts';
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
export const ADAPTED_MIT_SOURCE_PATH = 'crates/daw-dsp/src/toaster/engines/kick_808.rs';
export const ADAPTED_MIT_LICENSE_PATH = 'public/legal/MI-PLAITS-DSP-RS-MIT.txt';
export const ADAPTED_ORIGINAL_MIT_LICENSE_PATH = 'public/legal/MUTABLE-INSTRUMENTS-PLAITS-MIT.txt';
export const ADAPTED_MIT_NOTICE_PATH = 'public/legal/THIRD-PARTY-NOTICES.md';
export const ADAPTED_MIT_COMMIT = '6d3f7a5b84b25ec45d66c9f6be7109474690d795';
export const ADAPTED_ORIGINAL_COMMIT = '99432f2bf443219b3eb77e65e1a18583faad422e';
export const ADAPTED_ORIGINAL_SOURCE_PATH = 'plaits/dsp/drums/analog_bass_drum.h';
export const ADAPTED_ORIGINAL_SOURCE_SHA256 = '46e03e356685b20e7444b6979ad61579d962f4a4a08a748142fdc497ecaa23ea';
export const ADAPTED_MIT_UPSTREAM_PROOF_PATH = 'release/upstream-proofs/mi-plaits-dsp-rs-kick_808.rs';
export const ADAPTED_MIT_LICENSE_PROOF_PATH = 'release/upstream-proofs/mi-plaits-dsp-rs-LICENSE.txt';
export const ADAPTED_ORIGINAL_UPSTREAM_PROOF_PATH = 'release/upstream-proofs/mutable-instruments-analog_bass_drum.h';
export const ADAPTED_MIT_UPSTREAM_SOURCE_SHA256 = 'f70f0fbaf3cfd3bd1a9f8a8577f96159fee3da00358a9572ee355186858be949';
export const ADAPTED_MIT_LICENSE_SHA256 = 'b2ec3cd241dd660bd4de9f07dd94ecce3ee9c696eaf15af7af68eae6ed4af04c';

const SNAPSHOT_DIGEST_SURFACES: Readonly<Record<string, readonly string[]>> = {
    'pnpm-lock.yaml': ['javascript-dependencies'],
    'server/package-lock.json': ['javascript-dependencies', 'collaboration-server'],
    'Cargo.lock': ['rust-dependencies'],
};

export const OWNER_VISUAL_ASSET_PATHS = [
    'public/favicon.ico',
    'public/icon-192.png',
    'public/icon-transparent.png',
    'public/icon.png',
    'public/logo-parts/**',
    'sourdaw.png',
    'build/icons/**',
] as const;

const DDSP_TFJS_LEGAL_PATHS = [
    'public/legal/Apache-2.0.txt',
    'public/legal/Magenta.js-NOTICE.txt',
    'public/legal/TensorFlow.js-NOTICE.txt',
    'public/legal/seedrandom-MIT.txt',
    'public/legal/THIRD-PARTY-NOTICES.md',
] as const;

export const DDSP_TFJS_APPLICATION_RUNTIME_PATHS = [
    'src/modules/BrowserAi/models/InferenceRequest.ts',
    'src/modules/BrowserAi/repositories/inferenceWorkerBridge.ts',
    'src/modules/BrowserAi/services/computeDdspSessionKey.ts',
    'src/modules/BrowserAi/workers/tfjsInferenceWorker.ts',
    'src/modules/BrowserAi/workers/tfjsInferenceWorkerRuntime.ts',
] as const;

export const DDSP_TFJS_RUNTIME_PATHS = [
    'package.json',
    'pnpm-lock.yaml',
    ...DDSP_TFJS_LEGAL_PATHS,
    ...DDSP_TFJS_APPLICATION_RUNTIME_PATHS,
] as const;

export const DDSP_ADMISSION_DECISION_PATH = '.agents/decisions/0035-admit-direct-magenta-ddsp-checkpoint-downloads.md';
const DDSP_ARTIFACT_MANIFEST_PATH = 'src/modules/BrowserAi/models/DdspArtifactManifest.ts';
const DDSP_MODEL_ENFORCEMENT_PATHS = [
    'src/modules/BrowserAi/repositories/modelDownloadManager.ts',
    'src/modules/BrowserAi/useCases/downloadDdspInstrument.ts',
    'src/modules/BrowserAi/repositories/stageDdspInstrumentGeneration.ts',
    'src/modules/BrowserAi/repositories/publishDdspInstrumentGeneration.ts',
    'src/modules/BrowserAi/repositories/checkDdspInstrumentReady.ts',
    'src/modules/BrowserAi/repositories/cleanupUnpublishedDdspGeneration.ts',
    'src/modules/BrowserAi/repositories/ddspGenerationStorageSupport.ts',
    'src/modules/BrowserAi/repositories/modelStorageWorkerBridge.ts',
    'src/modules/BrowserAi/repositories/withDdspInstrumentLock.ts',
    'src/modules/BrowserAi/workers/modelStorageWorker.ts',
    'src/modules/BrowserAi/workers/modelStorageWorkerRuntime.ts',
    'src/infra/release/modelReleaseAdmission.ts',
    'src/modules/BrowserAi/models/DdspInstrumentCatalog.ts',
    'src/modules/BrowserAi/presentations/views/ModelManagerPanel.tsx',
    'src/modules/BrowserAi/repositories/removeDdspInstrumentGenerations.ts',
    'src/modules/BrowserAi/useCases/downloadModel.ts',
    'src/modules/BrowserAi/useCases/initBrowserAi.ts',
    'src/modules/BrowserAi/useCases/removeDdspInstrument.ts',
    'src/modules/BrowserAi/useCases/removeModel.ts',
    'src/modules/BrowserAi/useCases/renderDdspInstrument.ts',
] as const;

export const DDSP_MODEL_PATHS = [
    DDSP_ADMISSION_DECISION_PATH,
    'electron/protocol.ts',
    'public/legal/THIRD-PARTY-NOTICES.md',
    'src/modules/BrowserAi/models/DdspArtifactManifest.ts',
    ...DDSP_MODEL_ENFORCEMENT_PATHS,
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

export function readReleaseInventory(root: string): ReleaseInventory {
    const inventoryPath = resolve(root, 'release/open-source-inventory.json');
    return parseJsonWithUniqueKeys<ReleaseInventory>(readFileSync(inventoryPath, 'utf8'), inventoryPath);
}

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

function isSemanticSha256Label(value: string): boolean {
    return value.startsWith('@');
}

function isByteCountPrefixedRemoteArtifact(value: string): boolean {
    return /^(?:bytes:)?[0-9]+:/u.test(value);
}

function isUriLikeDigestLabel(value: string): boolean {
    return /^[a-z][a-z0-9+.+-]*:/iu.test(value);
}

function isWindowsPathLikeDigestLabel(value: string): boolean {
    return value.includes('\\') || win32.isAbsolute(value);
}

function pathAddressedSha256(value: string): { path: string; sha256: string } | undefined {
    const match = /^sha256:([0-9a-f]{64}):(.+)$/u.exec(value);
    const sha256 = match?.[1];
    const path = match?.[2];
    if (
        sha256 === undefined ||
        path === undefined ||
        isSemanticSha256Label(path) ||
        isByteCountPrefixedRemoteArtifact(path) ||
        (isUriLikeDigestLabel(path) && !isWindowsPathLikeDigestLabel(path))
    ) {
        return undefined;
    }
    return { path, sha256 };
}

function isCanonicalPathAddress(path: string): boolean {
    return (
        !path.includes('\\') &&
        !path.includes('\0') &&
        !posix.isAbsolute(path) &&
        !win32.isAbsolute(path) &&
        path !== '.' &&
        path !== '..' &&
        !path.endsWith('/') &&
        posix.normalize(path) === path
    );
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
            throw new Error(`Grand Boule release source is missing: ${file}`);
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
        throw new Error(`Grand Boule release source boundary has no tracked files: ${pathspecs.join(', ')}`);
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

function executableSource(source: string): string {
    const output = [...source];
    let mode: 'code' | 'line-comment' | 'block-comment' | 'single' | 'double' | 'template' = 'code';
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index]!;
        const next = source[index + 1];
        if (mode === 'line-comment') {
            if (character === '\n') {
                mode = 'code';
            } else {
                output[index] = ' ';
            }
            continue;
        }
        if (mode === 'block-comment') {
            output[index] = character === '\n' ? '\n' : ' ';
            if (character === '*' && next === '/') {
                output[index + 1] = ' ';
                index += 1;
                mode = 'code';
            }
            continue;
        }
        if (mode !== 'code') {
            output[index] = character === '\n' ? '\n' : ' ';
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (
                (mode === 'single' && character === "'") ||
                (mode === 'double' && character === '"') ||
                (mode === 'template' && character === '`')
            ) {
                mode = 'code';
            }
            continue;
        }
        if (character === '/' && next === '/') {
            output[index] = output[index + 1] = ' ';
            index += 1;
            mode = 'line-comment';
        } else if (character === '/' && next === '*') {
            output[index] = output[index + 1] = ' ';
            index += 1;
            mode = 'block-comment';
        } else if (character === "'") {
            output[index] = ' ';
            mode = 'single';
        } else if (character === '"') {
            output[index] = ' ';
            mode = 'double';
        } else if (character === '`') {
            output[index] = ' ';
            mode = 'template';
        }
    }
    return output.join('');
}

function balancedBody(source: string, openBrace: number): { body: string; start: number; end: number } | undefined {
    if (openBrace < 0) {
        return undefined;
    }
    let depth = 0;
    for (let index = openBrace; index < source.length; index += 1) {
        if (source[index] === '{') {
            depth += 1;
        } else if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) {
                return { body: source.slice(openBrace + 1, index), start: openBrace + 1, end: index };
            }
        }
    }
    return undefined;
}

function declaredBody(source: string, declaration: RegExp): string | undefined {
    const executable = executableSource(source);
    const match = declaration.exec(executable);
    if (match === null) {
        return undefined;
    }
    return balancedBody(executable, executable.indexOf('{', match.index + match[0].length - 1))?.body;
}

function topLevelExecutableCall(body: string, call: RegExp): boolean {
    const match = call.exec(body);
    if (match === null || /\breturn\b/u.test(body.slice(0, match.index))) {
        return false;
    }
    let depth = 0;
    for (const character of body.slice(0, match.index)) {
        if (character === '{') {
            depth += 1;
        } else if (character === '}') {
            depth -= 1;
        }
    }
    return depth === 0;
}

function hasGrandBouleConstructorText(path: string, source: string): boolean {
    if (path.endsWith('_bg.wasm.d.ts')) {
        return /\bexport\s+const\s+grandbouleinstance_new\s*:\s*\(\s*a\s*:\s*number\s*,\s*b\s*:\s*number\s*\)\s*=>\s*number\s*;/u.test(
            executableSource(source)
        );
    }
    const classBody = declaredBody(source, /\bexport\s+class\s+GrandBouleInstance\s*\{/u);
    if (classBody === undefined) {
        return false;
    }
    if (path.endsWith('.d.ts')) {
        return /\bconstructor\s*\(\s*sample_rate\s*:\s*number\s*,\s*voice_count\s*:\s*number\s*\)\s*;/u.test(classBody);
    }
    if (path.endsWith('.js')) {
        const constructor = declaredBody(classBody, /\bconstructor\s*\(\s*sample_rate\s*,\s*voice_count\s*\)\s*\{/u);
        return (
            constructor !== undefined &&
            topLevelExecutableCall(
                constructor,
                /\bwasm\s*\.\s*grandbouleinstance_new\s*\(\s*sample_rate\s*,\s*voice_count\s*\)/u
            )
        );
    }
    return false;
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
    return parseJsonWithUniqueKeys<WasmManifest>(
        readFileSync(resolve(root, WASM_MANIFEST_PATH), 'utf8'),
        WASM_MANIFEST_PATH
    );
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
    const declarations = source.match(/pub\s+mod\s+grand_boule\s*;/gu) ?? [];
    const gatedModule =
        /#\[cfg\s*\(\s*not\s*\(\s*target_arch\s*=\s*"wasm32"\s*\)\s*\)\s*\]\s*pub\s+mod\s+grand_boule\s*;/u;
    if (declarations.length !== 1 || gatedModule.test(source)) {
        throw new Error('Grand Boule must be included in the wasm32 crate graph at crates/daw-dsp/src/lib.rs');
    }
}

export const GRAND_BOULE_RUST_SOURCE_ADMISSION = {
    'attack_sampler.rs': 'owner-admitted project implementation',
    'coupled_strings.rs':
        'owner-admitted aftersound implementation retaining Weinreich inputs BRIDGE_COUPLING_GAIN=30 and HORIZONTAL_MIX=0.7',
    'duplex.rs': 'owner-admitted implementation using standard duplex-string acoustics',
    'engine.rs': 'owner-admitted orchestration and product voicing',
    'hammer.rs': 'owner-admitted implementation of the cited Stulov scientific relation',
    'longitudinal.rs': 'owner-admitted implementation using standard longitudinal-mode physics',
    'mechanical_noise.rs': 'owner-admitted implementation informed by cited mechanical-transient observations',
    'midi2.rs': 'owner-admitted implementation of public MIDI protocol facts',
    'mod.rs': 'owner-admitted host and WASM boundary',
    'parameters.rs': 'owner-admitted curves retaining cited Russell and Rossing measurement anchors',
    'pedals.rs': 'owner-admitted implementation using standard piano mechanics',
    'radiation.rs': 'owner-admitted radiation and microphone model',
    'soundboard.rs': 'owner-admitted finite body kernels and processing',
    'string.rs': 'owner-admitted modal coefficient implementation from standard string equations',
    'sympathetic.rs': 'owner-admitted sympathetic-resonance implementation',
    'voice.rs': 'owner-admitted voice lifecycle and coefficient composition',
} as const;

export function assertGrandBouleRustSourceAdmission(root: string): void {
    const rustRoot = 'crates/daw-dsp/src/grand_boule';
    const actual = trackedFiles(root, [rustRoot]).map((path) => path.slice(`${rustRoot}/`.length));
    const expected = Object.keys(GRAND_BOULE_RUST_SOURCE_ADMISSION).sort();
    const unsupported = actual.find((path) => !expected.includes(path));
    const missing = expected.find((path) => !actual.includes(path));
    if (unsupported !== undefined) {
        throw new Error(`Grand Boule Rust source has unsupported attribution gap: ${unsupported}`);
    }
    if (missing !== undefined) {
        throw new Error(`Grand Boule Rust source admission boundary is missing: ${missing}`);
    }
}

function rustGrandBouleConstructorTuple(source: string): number[] | null {
    const implBody = declaredBody(source, /\bimpl\s+GrandBouleEngine\s*\{/u);
    if (implBody === undefined) {
        return null;
    }
    const constructorBody = declaredBody(
        implBody,
        /\bpub\s+fn\s+new\s*\(\s*sample_rate\s*:\s*f32\s*,\s*voice_count\s*:\s*usize\s*\)\s*->\s*Self\s*\{/u
    );
    if (constructorBody === undefined || /\breturn\b/u.test(constructorBody)) {
        return null;
    }
    const initializer = declaredBody(constructorBody, /\bSelf\s*\{/u);
    if (initializer === undefined) {
        return null;
    }
    return [
        'hammer_hardness_scale',
        'hammer_mass_scale',
        'soundboard_brightness',
        'sympathetic_level',
        'body_resonance',
        'tone_color',
    ].map((field) => {
        const value = initializer.match(new RegExp(String.raw`\b${field}\s*:\s*(-?\d+(?:\.\d+)?)`, 'u'))?.[1];
        return value === undefined ? Number.NaN : Number(value);
    });
}

export function assertGrandBouleDesignAroundSource(root: string): void {
    assertGrandBouleRustSourceAdmission(root);
    const soundboardPath = 'crates/daw-dsp/src/grand_boule/soundboard.rs';
    const soundboard = readFileSync(resolve(root, soundboardPath), 'utf8');
    for (const required of [
        'const FIR_STAGE_COUNT: usize = 12;',
        'struct FeedForwardDelay',
        'const WARM_LEFT: KernelSpec',
        'const WARM_RIGHT: KernelSpec',
        'const OPEN_LEFT: KernelSpec',
        'const OPEN_RIGHT: KernelSpec',
        'input + delayed * self.delayed_gain',
    ]) {
        if (!soundboard.includes(required)) {
            throw new Error(`Grand Boule FIR body contract is missing ${required} in ${soundboardPath}`);
        }
    }
    for (const forbidden of ['SOUNDBOARD_MODES', 'rebuild_modes', 'gain_left:', 'gain_right:', 'y1:', 'y2:']) {
        if (soundboard.includes(forbidden)) {
            throw new Error(
                `Grand Boule FIR body contract rejects modal body source ${forbidden} in ${soundboardPath}`
            );
        }
    }

    const parametersPath = 'crates/daw-dsp/src/grand_boule/parameters.rs';
    const parameters = readFileSync(resolve(root, parametersPath), 'utf8');
    if (!parameters.includes('Project tuning curves and standard piano mappings')) {
        throw new Error(`Grand Boule parameter provenance must label project tuning in ${parametersPath}`);
    }
    if (/(?:Jaatinen|Pätynen|Hinrichsen|Steinway D|HAL RT|patent)/iu.test(parameters)) {
        throw new Error(`Grand Boule parameter provenance contains an unsupported source claim in ${parametersPath}`);
    }
    if (!parameters.includes('let exponent = 7.86_f32 + 1.88 * t.powf(1.32) + 0.14 * t * (1.0 - t);')) {
        throw new Error(`Grand Boule project hammer-stiffness curve is missing in ${parametersPath}`);
    }
    if (/8\.0_f32\s*\+\s*0\.020\s*\*\s*\(key as f32 - 1\.0\)/u.test(parameters)) {
        throw new Error(`Grand Boule rejects the legacy hammer-stiffness formula in ${parametersPath}`);
    }

    const enginePath = 'crates/daw-dsp/src/grand_boule/engine.rs';
    const engine = readFileSync(resolve(root, enginePath), 'utf8');
    const constructorTuple = rustGrandBouleConstructorTuple(engine);
    const balancedTuple = [0.92, 1.08, 0.48, 0.58, 0.52, -0.08];
    if (JSON.stringify(constructorTuple) !== JSON.stringify(balancedTuple)) {
        throw new Error(`Grand Boule Rust constructor must use the balanced-grand tuple in ${enginePath}`);
    }

    const coupledStringsPath = 'crates/daw-dsp/src/grand_boule/coupled_strings.rs';
    const coupledStrings = readFileSync(resolve(root, coupledStringsPath), 'utf8');
    for (const required of [
        'fn polarization_decay_hz(note_frequency_hz: f32) -> PolarizationDecay',
        'prompt_hz: 0.58 + 0.72 * register + 7.2 * register.powf(2.4)',
        'aftersound_hz: 0.012 + 0.025 * register + 0.105 * register * register',
        'const POLARIZATION_TRANSFER_GAIN: f32 = 30.0;',
        'const AFTERSOUND_MIX: f32 = 0.7;',
        'No body or soundboard property enters string coefficient',
    ]) {
        if (!coupledStrings.includes(required)) {
            throw new Error(
                `Grand Boule project polarization-decay source is missing ${required} in ${coupledStringsPath}`
            );
        }
    }
    if (
        /(?:sigma_bridge|bridge[- ]admittance|SIGMA_SLOW_SCALE|BRIDGE_COUPLING_GAIN|0\.8\s*\+\s*fundamental_hz\s*\*\s*0\.004)/iu.test(
            coupledStrings
        )
    ) {
        throw new Error(`Grand Boule rejects the legacy bridge-derived decay source in ${coupledStringsPath}`);
    }

    const voicingsPath = 'src/modules/GrandBoule/models/GrandBouleMorphState.ts';
    const voicings = readFileSync(resolve(root, voicingsPath), 'utf8');
    const productVoicings = {
        'balanced-grand': [0.92, 1.08, 0.48, 0.58, 0.52, -0.08],
        'mellow-grand': [0.72, 1.25, 0.32, 0.74, 0.82, -0.58],
        'clear-grand': [1.34, 0.82, 0.78, 0.36, 0.42, 0.56],
        'singing-grand': [1.12, 0.94, 0.68, 0.66, 0.57, 0.28],
    } as const;
    const legacyVoicingTuples = [
        [1, 1, 0.55, 0.5, 0.6, 0],
        [0.6, 1.4, 0.25, 0.8, 0.9, -0.7],
        [1.5, 0.7, 0.85, 0.3, 0.35, 0.7],
        [1.2, 0.85, 0.75, 0.6, 0.5, 0.4],
    ] as const;
    const tupleFields = [
        'hammerHardnessScale',
        'hammerMassScale',
        'soundboardBrightness',
        'sympatheticLevel',
        'bodyResonance',
        'toneColor',
    ] as const;
    for (const [id, expectedTuple] of Object.entries(productVoicings)) {
        const block = voicings.match(new RegExp(String.raw`\{\s*id:\s*['"]${id}['"][\s\S]*?\n\s*\}`, 'u'))?.[0];
        if (block === undefined) {
            throw new Error(`Grand Boule product voicing contract is missing neutral id ${id} in ${voicingsPath}`);
        }
        const tuple = tupleFields.map((field) => {
            const value = block.match(new RegExp(String.raw`${field}:\s*(-?\d+(?:\.\d+)?)`, 'u'))?.[1];
            return value === undefined ? Number.NaN : Number(value);
        });
        if (legacyVoicingTuples.some((legacyTuple) => JSON.stringify(tuple) === JSON.stringify(legacyTuple))) {
            throw new Error(
                `Grand Boule product voicing contract rejects a legacy branded tuple for ${id} in ${voicingsPath}`
            );
        }
        if (JSON.stringify(tuple) !== JSON.stringify(expectedTuple)) {
            throw new Error(
                `Grand Boule product voicing contract does not pin the project tuple for ${id} in ${voicingsPath}`
            );
        }
    }
    if (/name:\s*['"](?:Steinway|Bösendorfer|Bosendorfer|Yamaha|Fazioli)/u.test(voicings)) {
        throw new Error(
            `Grand Boule product voicing contract rejects brand-specific display labels in ${voicingsPath}`
        );
    }
    for (const legacyId of ['steinway-d', 'bosendorfer-imperial', 'yamaha-cfx', 'fazioli-f308']) {
        if (voicings.includes(legacyId)) {
            throw new Error(
                `Grand Boule product voicing contract rejects legacy branded id ${legacyId} in ${voicingsPath}`
            );
        }
    }
}

export function assertGrandBouleReleasedInWasm(root: string): void {
    const census = distributedWasmArtifactCensus(root);
    const dawDspPackage = wasmArtifacts.packages.find(({ id }) => id === 'daw-dsp');
    if (dawDspPackage === undefined) {
        throw new Error('distributed WASM contract is missing the daw-dsp package');
    }
    const dawDspArtifacts = new Set(dawDspPackage.artifacts);

    for (const path of census.textArtifacts.filter(
        (artifact) => dawDspArtifacts.has(artifact) && !artifact.endsWith('/package.json')
    )) {
        if (!hasGrandBouleConstructorText(path, readFileSync(resolve(root, path), 'utf8'))) {
            throw new Error(
                `Grand Boule constructor must be exposed exactly by distributed daw-dsp WASM surface ${path}`
            );
        }
    }

    for (const path of census.wasmArtifacts.filter((artifact) => dawDspArtifacts.has(artifact))) {
        const module = new WebAssembly.Module(readFileSync(resolve(root, path)));
        const constructorExport = WebAssembly.Module.exports(module).find(
            ({ name, kind }) => name === 'grandbouleinstance_new' && kind === 'function'
        );
        if (constructorExport === undefined) {
            throw new Error(
                `Grand Boule constructor export must be exposed by distributed daw-dsp WASM binary ${path}`
            );
        }
    }
}

const GRAND_BOULE_MEASUREMENT_SOURCE_PATHS = [
    'crates/daw-dsp/benches/quantum.rs',
    'crates/daw-dsp/benches/wasm/deviceRecipes.js',
    'crates/daw-dsp/benches/wasm/quantumCostProcessor.js',
    'public/wasm/daw-dsp/daw_dsp_bg.wasm',
] as const;

export function assertGrandBouleMeasurementAdmission(root: string): void {
    const jsonPath = 'crates/daw-dsp/benches/quantum-cost-table.json';
    const markdownPath = 'crates/daw-dsp/benches/quantum-cost-table.md';
    const data = JSON.parse(readFileSync(resolve(root, jsonPath), 'utf8')) as {
        sourceRevision?: string;
        sourceDigests?: Record<string, string>;
        machine?: { gitSha?: string; workingTree?: string };
        budgetMs?: number;
        referenceProject?: { audioWorstQuantumUpperMs?: number; workerMedianMs?: number };
        rows?: Array<{
            id?: string;
            costSite?: string;
            warmVerify?: { ok?: boolean; detail?: string };
            lateVerify?: { ok?: boolean; detail?: string };
        }>;
    };
    const revision = data.sourceRevision;
    if (!revision || revision !== data.machine?.gitSha || data.machine?.workingTree !== 'clean') {
        throw new Error('Grand Boule measurement must name one clean implementation source revision');
    }
    const digestPaths = Object.keys(data.sourceDigests ?? {}).sort();
    if (JSON.stringify(digestPaths) !== JSON.stringify([...GRAND_BOULE_MEASUREMENT_SOURCE_PATHS].sort())) {
        throw new Error('Grand Boule measurement source-digest census is incomplete');
    }
    for (const path of GRAND_BOULE_MEASUREMENT_SOURCE_PATHS) {
        let sourceAtRevision: Buffer;
        try {
            sourceAtRevision = execFileSync('git', ['show', `${revision}:${path}`], { cwd: root });
        } catch {
            throw new Error(`Grand Boule measurement source revision ${revision} cannot provide ${path}`);
        }
        const recordedDigest = data.sourceDigests![path]!;
        const revisionDigest = createHash('sha256').update(sourceAtRevision).digest('hex');
        if (recordedDigest !== revisionDigest) {
            throw new Error(`Grand Boule measurement recorded digest does not match source revision for ${path}`);
        }
        const currentDigest = createHash('sha256')
            .update(readFileSync(resolve(root, path)))
            .digest('hex');
        if (recordedDigest !== currentDigest) {
            throw new Error(`Grand Boule measurement current source digest drifted for ${path}`);
        }
    }
    const rows = data.rows?.filter((row) => row.id === 'grand_boule') ?? [];
    const row = rows[0];
    const exactVoiceProof = /active_voices\(\)\s*=\s*64,\s*expected\s+64/u;
    if (
        rows.length !== 1 ||
        row?.costSite !== 'worker' ||
        row.warmVerify?.ok !== true ||
        row.lateVerify?.ok !== true ||
        !exactVoiceProof.test(row.warmVerify.detail ?? '') ||
        !exactVoiceProof.test(row.lateVerify.detail ?? '')
    ) {
        throw new Error('Grand Boule measured row must prove exactly 64 active voices before and after timing');
    }
    if (
        typeof data.budgetMs !== 'number' ||
        typeof data.referenceProject?.audioWorstQuantumUpperMs !== 'number' ||
        typeof data.referenceProject.workerMedianMs !== 'number' ||
        data.referenceProject.audioWorstQuantumUpperMs >= data.budgetMs ||
        data.referenceProject.workerMedianMs >= data.budgetMs
    ) {
        throw new Error('Grand Boule measured reference project exceeds its render budget');
    }
    const markdown = readFileSync(resolve(root, markdownPath), 'utf8');
    assertGeneratedRegionMatches(markdown, data);
    for (const required of [revision, row.warmVerify.detail!, row.lateVerify.detail!]) {
        if (!markdown.includes(required)) {
            throw new Error(`Grand Boule JSON and Markdown measurement tables disagree on ${required}`);
        }
    }
    for (const [path, digest] of Object.entries(data.sourceDigests ?? {})) {
        if (!markdown.includes(path) || !markdown.includes(`sha256:${digest}`)) {
            throw new Error(`Grand Boule Markdown measurement provenance omits ${path}`);
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
        licenses: ['Apache-2.0'],
    };
}

export function adaptedMitSourceReleaseInventoryContract(root: string): SurfaceContract {
    assertAdaptedMitSourceProofs(root);
    return {
        kind: 'adapted-source',
        paths: [
            ADAPTED_MIT_SOURCE_PATH,
            ADAPTED_MIT_UPSTREAM_PROOF_PATH,
            ADAPTED_MIT_LICENSE_PROOF_PATH,
            ADAPTED_ORIGINAL_UPSTREAM_PROOF_PATH,
            ADAPTED_MIT_LICENSE_PATH,
            ADAPTED_ORIGINAL_MIT_LICENSE_PATH,
            ADAPTED_MIT_NOTICE_PATH,
        ],
        sources: [
            `git:github.com/sourcebox/mi-plaits-dsp-rs@${ADAPTED_MIT_COMMIT}:src/drums/analog_bass_drum.rs`,
            `git:github.com/sourcebox/mi-plaits-dsp-rs@${ADAPTED_MIT_COMMIT}:LICENSE.txt`,
            `git:github.com/pichenettes/eurorack@${ADAPTED_ORIGINAL_COMMIT}:${ADAPTED_ORIGINAL_SOURCE_PATH}`,
            ADAPTED_MIT_SOURCE_PATH,
        ],
        revisions: [ADAPTED_MIT_COMMIT, ADAPTED_ORIGINAL_COMMIT],
        digests: [
            `sha256:${fileSha256(resolve(root, ADAPTED_MIT_SOURCE_PATH))}:${ADAPTED_MIT_SOURCE_PATH}`,
            `sha256:${ADAPTED_MIT_UPSTREAM_SOURCE_SHA256}:${ADAPTED_MIT_UPSTREAM_PROOF_PATH}`,
            `sha256:${ADAPTED_MIT_LICENSE_SHA256}:git:github.com/sourcebox/mi-plaits-dsp-rs@${ADAPTED_MIT_COMMIT}:LICENSE.txt`,
            `sha256:${ADAPTED_MIT_LICENSE_SHA256}:${ADAPTED_MIT_LICENSE_PROOF_PATH}`,
            `sha256:${fileSha256(resolve(root, ADAPTED_MIT_LICENSE_PATH))}:${ADAPTED_MIT_LICENSE_PATH}`,
            `sha256:${ADAPTED_ORIGINAL_SOURCE_SHA256}:git:github.com/pichenettes/eurorack@${ADAPTED_ORIGINAL_COMMIT}:${ADAPTED_ORIGINAL_SOURCE_PATH}`,
            `sha256:${ADAPTED_ORIGINAL_SOURCE_SHA256}:${ADAPTED_ORIGINAL_UPSTREAM_PROOF_PATH}`,
            `sha256:${fileSha256(resolve(root, ADAPTED_ORIGINAL_MIT_LICENSE_PATH))}:${ADAPTED_ORIGINAL_MIT_LICENSE_PATH}`,
            `sha256:${fileSha256(resolve(root, ADAPTED_MIT_NOTICE_PATH))}:${ADAPTED_MIT_NOTICE_PATH}`,
        ],
        licenses: ['MIT'],
    };
}

export function assertAdaptedMitSourceProofs(root: string): void {
    for (const [path, expected] of [
        [ADAPTED_MIT_UPSTREAM_PROOF_PATH, ADAPTED_MIT_UPSTREAM_SOURCE_SHA256],
        [ADAPTED_ORIGINAL_UPSTREAM_PROOF_PATH, ADAPTED_ORIGINAL_SOURCE_SHA256],
    ] as const) {
        if (fileSha256(resolve(root, path)) !== expected) {
            throw new Error(`${path}: pinned upstream source proof drifted`);
        }
    }
    if (fileSha256(resolve(root, ADAPTED_MIT_LICENSE_PROOF_PATH)) !== ADAPTED_MIT_LICENSE_SHA256) {
        throw new Error(`${ADAPTED_MIT_LICENSE_PROOF_PATH}: pinned upstream license proof drifted`);
    }
    if (fileSha256(resolve(root, ADAPTED_MIT_LICENSE_PATH)) !== ADAPTED_MIT_LICENSE_SHA256) {
        throw new Error(`${ADAPTED_MIT_LICENSE_PATH}: distributed upstream license drifted`);
    }
}

export function projectLicenseDistributionReleaseInventoryContract(root: string): SurfaceContract {
    const paths = [
        '.gitattributes',
        'LICENSE',
        'NOTICE',
        'public/legal/Apache-2.0.txt',
        DEPENDENCY_LICENSE_REPORT_PATH,
        'public/legal/SOURDAW-NOTICE.txt',
        'public/legal/THIRD-PARTY-NOTICES.md',
        'package.json',
        'server/LICENSE',
        'server/NOTICE',
        'server/THIRD-PARTY-NOTICES.md',
        'server/package.json',
        'Cargo.toml',
        'crates/**',
        'release/dependency-license-proofs.json',
        'release/dependency-license-proofs/**',
        'release/spdx-license-texts/**',
        'release/upstream-proofs/**',
        'scripts/dependencyLicenseReport.ts',
    ];
    return {
        kind: 'distribution',
        paths,
        sources: paths,
        revisions: ['current tracked project license and pinned dependency evidence'],
        digests: [
            `sha256:${fileSha256(resolve(root, 'LICENSE'))}:LICENSE`,
            `sha256:${fileSha256(resolve(root, 'NOTICE'))}:NOTICE`,
            `sha256:${fileSha256(resolve(root, DEPENDENCY_LICENSE_REPORT_PATH))}:${DEPENDENCY_LICENSE_REPORT_PATH}`,
            `sha256:${fileSha256(resolve(root, 'release/dependency-license-proofs.json'))}:release/dependency-license-proofs.json`,
        ],
        licenses: ['Apache-2.0', `per-package terms:${DEPENDENCY_LICENSE_REPORT_PATH}`],
    };
}

export function assertProjectLicenseDistributionReleaseInventory(
    root: string,
    surface: Partial<ReleaseSurface> | undefined
): void {
    assertSurfaceContract(
        surface,
        projectLicenseDistributionReleaseInventoryContract(root),
        'project license distribution'
    );
}

type GrandBouleReleaseBoundary = {
    paths: readonly string[];
    gitPathspecs: readonly string[];
    digestLabel: string;
};

export const GRAND_BOULE_RELEASE_REGISTRY = {
    kind: 'project-source',
    retention: 'keep',
    owner: 'OS-10',
    releaseModes: ['source', 'web', 'desktop'],
    productSurfaces: ['Grand Boule source, browser WASM, and desktop runtime'],
    boundaries: [
        {
            paths: ['crates/daw-dsp/src/grand_boule/**'],
            gitPathspecs: ['crates/daw-dsp/src/grand_boule'],
            digestLabel: 'grand-boule-native-rust',
        },
        {
            paths: ['.agents/decisions/0036-readmit-grand-boule.md'],
            gitPathspecs: ['.agents/decisions/0036-readmit-grand-boule.md'],
            digestLabel: 'grand-boule-admission-decision',
        },
        {
            paths: [
                'src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts',
                'src/modules/Arrangement/useCases/preset/sidebarInstrumentPresets.ts',
                'src/modules/ContentBrowser/presentations/views/Sidebar/InstrumentsTab.tsx',
            ],
            gitPathspecs: [
                'src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts',
                'src/modules/Arrangement/useCases/preset/sidebarInstrumentPresets.ts',
                'src/modules/ContentBrowser/presentations/views/Sidebar/InstrumentsTab.tsx',
            ],
            digestLabel: 'grand-boule-discovery-catalog',
        },
        {
            paths: [
                'src/infra/release/deviceReleaseAdmission.ts',
                'src/modules/AudioEngine/repositories/deviceStrategy/nativeDspDeviceFactories.ts',
                'src/modules/AudioEngine/repositories/deviceStrategy/unrenderableCatalogDeviceTypes.ts',
                'src/utils/nativeDspDeviceTypes.ts',
            ],
            gitPathspecs: [
                'src/infra/release/deviceReleaseAdmission.ts',
                'src/modules/AudioEngine/repositories/deviceStrategy/nativeDspDeviceFactories.ts',
                'src/modules/AudioEngine/repositories/deviceStrategy/unrenderableCatalogDeviceTypes.ts',
                'src/utils/nativeDspDeviceTypes.ts',
            ],
            digestLabel: 'grand-boule-factory-admission',
        },
        {
            paths: [
                'src/modules/AudioEngine/engine/GrandBouleNode.ts',
                'src/modules/AudioEngine/engine/wasmDeviceRegistry.ts',
                'src/modules/AudioEngine/models/AudioEngineState.ts',
                'src/modules/AudioEngine/models/GrandBouleRingProtocol.ts',
                'src/modules/AudioEngine/repositories/createWebAudioEngine.ts',
                'src/modules/AudioEngine/workers/grandBouleEngineWorker.ts',
                'src/modules/AudioEngine/worklets/grandBoule*.ts',
                'src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts',
            ],
            gitPathspecs: [
                'src/modules/AudioEngine/engine/GrandBouleNode.ts',
                'src/modules/AudioEngine/engine/wasmDeviceRegistry.ts',
                'src/modules/AudioEngine/models/AudioEngineState.ts',
                'src/modules/AudioEngine/models/GrandBouleRingProtocol.ts',
                'src/modules/AudioEngine/repositories/createWebAudioEngine.ts',
                'src/modules/AudioEngine/workers/grandBouleEngineWorker.ts',
                ':(glob)src/modules/AudioEngine/worklets/grandBoule*.ts',
                'src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts',
            ],
            digestLabel: 'grand-boule-live-runtime',
        },
        {
            paths: [
                'src/modules/GrandBoule/**',
                'src/modules/Command/useCases/versionedCommandArgumentKeys.ts',
                'src/modules/Arrangement/useCases/index.ts',
                'src/modules/Arrangement/useCases/device/setDeviceState.ts',
                'src/app/bootstrap.ts',
                'src/app/getProductionCommandHandlerMaps.ts',
                'src/utils/handlerContract.ts',
            ],
            gitPathspecs: [
                'src/modules/GrandBoule',
                'src/modules/Command/useCases/versionedCommandArgumentKeys.ts',
                'src/modules/Arrangement/useCases/index.ts',
                'src/modules/Arrangement/useCases/device/setDeviceState.ts',
                'src/app/bootstrap.ts',
                'src/app/getProductionCommandHandlerMaps.ts',
                'src/utils/handlerContract.ts',
            ],
            digestLabel: 'grand-boule-project-state',
        },
        {
            paths: [
                'src/app/prepareOfflineDeviceSetup.ts',
                'src/modules/AudioEngine/useCases/buildDeviceChain.ts',
                'src/modules/GrandBoule/useCases/prepareOfflineGrandBoule.ts',
            ],
            gitPathspecs: [
                'src/app/prepareOfflineDeviceSetup.ts',
                'src/modules/AudioEngine/useCases/buildDeviceChain.ts',
                'src/modules/GrandBoule/useCases/prepareOfflineGrandBoule.ts',
            ],
            digestLabel: 'grand-boule-offline-composition',
        },
        {
            paths: [
                'crates/daw-dsp/benches/quantum.rs',
                'crates/daw-dsp/benches/wasm/deviceRecipes.js',
                'crates/daw-dsp/benches/wasm/quantumCostProcessor.js',
                'crates/daw-dsp/benches/wasm/run.mjs',
                'crates/daw-dsp/benches/wasm/renderTable.mjs',
                'crates/daw-dsp/benches/wasm/renderTable.d.mts',
                'crates/daw-dsp/benches/quantum-cost-table.json',
                'crates/daw-dsp/benches/quantum-cost-table.md',
                'crates/daw-dsp/tests/quantum_bench_census.rs',
                'scripts/checkReleaseInventory.ts',
            ],
            gitPathspecs: [
                'crates/daw-dsp/benches/quantum.rs',
                'crates/daw-dsp/benches/wasm/deviceRecipes.js',
                'crates/daw-dsp/benches/wasm/quantumCostProcessor.js',
                'crates/daw-dsp/benches/wasm/run.mjs',
                'crates/daw-dsp/benches/wasm/renderTable.mjs',
                'crates/daw-dsp/benches/wasm/renderTable.d.mts',
                'crates/daw-dsp/benches/quantum-cost-table.json',
                'crates/daw-dsp/benches/quantum-cost-table.md',
                'crates/daw-dsp/tests/quantum_bench_census.rs',
                'scripts/checkReleaseInventory.ts',
            ],
            digestLabel: 'grand-boule-release-proof',
        },
    ] satisfies readonly GrandBouleReleaseBoundary[],
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
        kind: GRAND_BOULE_RELEASE_REGISTRY.kind,
        retention: GRAND_BOULE_RELEASE_REGISTRY.retention,
        owner: GRAND_BOULE_RELEASE_REGISTRY.owner,
        releaseModes: [...GRAND_BOULE_RELEASE_REGISTRY.releaseModes],
        paths: GRAND_BOULE_RELEASE_REGISTRY.boundaries.flatMap(({ paths }) => [...paths]),
        sources: [
            'crates/daw-dsp/src/grand_boule/',
            '.agents/decisions/0036-readmit-grand-boule.md',
            'Grand Boule discovery, catalog, factory, and release-admission source',
            'Grand Boule AudioEngine live host, registry, scheduling, worker, and worklet source',
            'Grand Boule project-state action, hydration, and offline-composition source',
            'Grand Boule browser runner, gates, reference population, processor, recipe, renderer, native benchmark, census, retained JSON/Markdown evidence, and release-checker source',
            'distributed daw-dsp WASM glue, declarations, mirrors, and binary',
        ],
        revisions: [
            'current tracked Rust source',
            'current tracked ADR 0036 source-admission record',
            'current tracked discovery, factory, and release-admission boundaries',
            'current tracked live host, scheduling, action, hydration, and offline boundaries',
            'current tracked browser/native measurement proof sources, retained evidence, and exact source-digest list owners',
        ],
        digests: GRAND_BOULE_RELEASE_REGISTRY.boundaries.map(
            ({ gitPathspecs, digestLabel }) =>
                `tracked-set-sha256:${trackedSetSha256(root, gitPathspecs)}:${digestLabel}`
        ),
        licenses: ['Apache-2.0'],
        productSurfaces: [...GRAND_BOULE_RELEASE_REGISTRY.productSurfaces],
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
        licenses: ['Apache-2.0'],
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
            ...DDSP_TFJS_APPLICATION_RUNTIME_PATHS.map((path) => `sha256:${fileSha256(resolve(root, path))}:${path}`),
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
            'Exact package versions and npm integrity digests are pinned in the install graph; package and lock file contents are not independently content-digested here.',
            'The release validator content-digests the application runtime sources and legal files listed by this surface.',
            'Together these records bind the dependency integrity, application runtime, and legal-file obligations represented here without claiming a self-referential complete closure.',
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
    const decision = readFileSync(resolve(root, DDSP_ADMISSION_DECISION_PATH), 'utf8');
    const admittedManifest = /Admitted `DdspArtifactManifest` SHA-256:\s*`([a-f0-9]{64})`/u.exec(decision)?.[1];
    const currentManifest = fileSha256(resolve(root, DDSP_ARTIFACT_MANIFEST_PATH));
    if (admittedManifest === undefined || admittedManifest !== currentManifest) {
        throw new Error('ADR 0035 does not admit the current DDSP artifact manifest');
    }
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
            `sha256:${currentManifest}:${DDSP_ARTIFACT_MANIFEST_PATH}`,
            `sha256:${fileSha256(resolve(root, 'public/legal/THIRD-PARTY-NOTICES.md'))}:public/legal/THIRD-PARTY-NOTICES.md`,
            ...DDSP_MODEL_ENFORCEMENT_PATHS.map((path) => `sha256:${fileSha256(resolve(root, path))}:${path}`),
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
            'Rollback requires all of: set MODEL_RELEASE_ADMISSION.ddsp to false; remove the exact Magenta DDSP source from electron/protocol.ts connect-src; and remove its release inventory egress assignment from release/open-source-inventory.json.',
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
        licenses: ['Apache-2.0', `per-package terms:${DEPENDENCY_LICENSE_REPORT_PATH}`],
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
    if (path === DEPENDENCY_LICENSE_REPORT_PATH) {
        return false;
    }
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
    if (path === DEPENDENCY_LICENSE_REPORT_PATH) {
        return false;
    }
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
    const trackedFiles = new Set(snapshot.releaseFiles);
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
        if (surface.retention === 'keep' && surface.licenses.some((license) => license.startsWith('unverified:'))) {
            errors.push(`${surface.id}: keep surfaces cannot carry unverified rights`);
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
        for (const digest of surface.digests) {
            const addressed = pathAddressedSha256(digest);
            if (addressed === undefined) {
                continue;
            }
            if (!isCanonicalPathAddress(addressed.path)) {
                errors.push(
                    `${surface.id}: path-addressed digest path must be normalized and relative: ${addressed.path}`
                );
            } else if (!trackedFiles.has(addressed.path)) {
                errors.push(`${surface.id}: path-addressed digest target is missing or untracked: ${addressed.path}`);
            } else if (snapshot.fileDigests[addressed.path] !== addressed.sha256) {
                errors.push(`${surface.id}: path-addressed digest drifted: ${addressed.path}`);
            }
        }
    }

    for (const [path, surfaceIdsForSnapshot] of Object.entries(SNAPSHOT_DIGEST_SURFACES)) {
        const expected = `sha256:${snapshot.fileDigests[path] ?? 'missing'}`;
        for (const surfaceId of surfaceIdsForSnapshot) {
            const surface = inventory.surfaces.find((candidate) => candidate.id === surfaceId);
            if (surface !== undefined && !surface.digests.includes(expected)) {
                errors.push(`${surfaceId}: digest must match ${path} snapshot (${expected})`);
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
    inventory: Pick<ReleaseInventory, 'snapshots' | 'marks'> & Partial<Pick<ReleaseInventory, 'surfaces'>>,
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
        ...(inventory.surfaces ?? []).flatMap((surface) =>
            surface.digests.flatMap((digest) => {
                const addressed = pathAddressedSha256(digest);
                return addressed === undefined || !isCanonicalPathAddress(addressed.path) ? [] : [addressed.path];
            })
        ),
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

export function checkReleaseInventory(
    root: string,
    projectLicensePreflight = checkProjectLicense
): ReleaseInventoryCheckReceipt {
    projectLicensePreflight(root);
    const inventory = readReleaseInventory(root);
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
    assertGrandBouleDesignAroundSource(root);
    assertGrandBouleReleasedInWasm(root);
    assertGrandBouleMeasurementAdmission(root);
    const wasmSurface = inventory.surfaces.find((surface) => surface.id === 'project-wasm');
    validateSurface('project-wasm', () =>
        assertSurfaceContract(wasmSurface, wasmReleaseInventoryContract(root, wasmArtifacts.readManifest()), 'WASM')
    );
    const projectLicenseSurface = inventory.surfaces.find((surface) => surface.id === 'project-license-distribution');
    validateSurface('project-license-distribution', () =>
        assertProjectLicenseDistributionReleaseInventory(root, projectLicenseSurface)
    );
    const grandBouleSurface = inventory.surfaces.find((surface) => surface.id === 'grand-boule');
    validateSurface('grand-boule', () => assertGrandBouleReleaseInventory(root, grandBouleSurface));
    const workletSurface = inventory.surfaces.find((surface) => surface.id === 'audio-worklet-sources');
    validateSurface('audio-worklet-sources', () =>
        assertSurfaceContract(workletSurface, audioWorkletReleaseInventoryContract(root), 'audio worklet')
    );
    const adaptedMitSurface = inventory.surfaces.find((surface) => surface.id === 'mi-plaits-dsp-rs-adaptation');
    validateSurface('mi-plaits-dsp-rs-adaptation', () =>
        assertSurfaceContract(
            adaptedMitSurface,
            adaptedMitSourceReleaseInventoryContract(root),
            'mi-plaits-dsp-rs adaptation'
        )
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
        licenses: [levain.source.license, 'Apache-2.0'],
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

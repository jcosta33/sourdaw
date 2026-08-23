import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { renderGeneratedRegion } from '../../crates/daw-dsp/benches/wasm/renderTable.mjs';
import {
    adaptedMitSourceReleaseInventoryContract,
    ADAPTED_MIT_COMMIT,
    ADAPTED_MIT_LICENSE_PATH,
    ADAPTED_MIT_LICENSE_PROOF_PATH,
    ADAPTED_MIT_NOTICE_PATH,
    ADAPTED_MIT_SOURCE_PATH,
    ADAPTED_MIT_UPSTREAM_PROOF_PATH,
    ADAPTED_ORIGINAL_COMMIT,
    ADAPTED_ORIGINAL_MIT_LICENSE_PATH,
    ADAPTED_ORIGINAL_SOURCE_PATH,
    ADAPTED_ORIGINAL_SOURCE_SHA256,
    ADAPTED_ORIGINAL_UPSTREAM_PROOF_PATH,
    assertGrandBouleDesignAroundSource,
    assertGrandBouleMeasurementAdmission,
    assertDdspReleaseInventory,
    assertDdspModelsReleaseInventory,
    assertGrandBouleReleaseInventory,
    assertGrandBouleReleasedInWasm,
    assertProjectLicenseDistributionReleaseInventory,
    assertGrandBouleRustSourceAdmission,
    assertGrandBouleRustWasmBoundary,
    audioWorkletReleaseInventoryContract,
    checkReleaseInventory,
    DDSP_ADMISSION_DECISION_PATH,
    DDSP_MODEL_PATHS,
    DDSP_TFJS_APPLICATION_RUNTIME_PATHS,
    DDSP_TFJS_RUNTIME_PATHS,
    GRAND_BOULE_MEASUREMENT_SOURCE_PATHS,
    ddspModelsReleaseInventoryContract,
    ddspTfjsRuntimeReleaseInventoryContract,
    distributedWasmArtifactCensus,
    GRAND_BOULE_RELEASE_REGISTRY,
    grandBouleReleaseInventoryContract,
    loadRepositorySnapshot,
    OWNER_VISUAL_ASSET_PATHS,
    ownerVisualAssetReleaseInventoryContract,
    projectLicenseDistributionReleaseInventoryContract,
    readReleaseInventory,
    REQUIRED_SNAPSHOT_PATHS,
    TRADEMARK_NOTICE_PATH,
    trademarkReleaseInventoryContract,
    type ReleaseInventory,
    type RepositorySnapshot,
    validateReleaseInventory,
    wasmReleaseInventoryContract,
} from '../checkReleaseInventory';
import { DEPENDENCY_LICENSE_REPORT_PATH } from '../dependencyLicenseReport';
import { wasmArtifacts, type WasmManifest } from '../wasm-artifacts';

const fixtureDigest = 'a'.repeat(64);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repositoryDistributedArtifacts = distributedWasmArtifactCensus(repositoryRoot);
const repositoryDawDspArtifacts = new Set(wasmArtifacts.packages.find(({ id }) => id === 'daw-dsp')?.artifacts ?? []);
const ddspTfjsApplicationRuntimePathSet = new Set<string>(DDSP_TFJS_APPLICATION_RUNTIME_PATHS);
const ddspModelEnforcementPaths = [
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

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function writeDdspModelContractFixture(root: string, manifest: string): void {
    const manifestPath = 'src/modules/BrowserAi/models/DdspArtifactManifest.ts';
    for (const [path, value] of [
        [manifestPath, manifest],
        ['electron/protocol.ts', 'protocol'],
        ['public/legal/THIRD-PARTY-NOTICES.md', 'notice'],
        [DDSP_ADMISSION_DECISION_PATH, `Admitted \`DdspArtifactManifest\` SHA-256: \`${sha256(manifest)}\``],
        ...ddspModelEnforcementPaths.map((path) => [path, `baseline:${path}`] as const),
    ] as const) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), value);
    }
}

function wasmWithFunctionExport(name: string): Uint8Array {
    const encodedName = new TextEncoder().encode(name);
    if (encodedName.length >= 128) {
        throw new RangeError('fixture export name must fit in one unsigned LEB128 byte');
    }
    const exportPayload = [1, encodedName.length, ...encodedName, 0, 0];
    return Uint8Array.from([
        0x00,
        0x61,
        0x73,
        0x6d,
        0x01,
        0x00,
        0x00,
        0x00,
        0x01,
        0x04,
        0x01,
        0x60,
        0x00,
        0x00,
        0x03,
        0x02,
        0x01,
        0x00,
        0x07,
        exportPayload.length,
        ...exportPayload,
        0x0a,
        0x04,
        0x01,
        0x02,
        0x00,
        0x0b,
    ]);
}

function grandBouleTextConstructorFixture(path: string): string {
    if (path.endsWith('_bg.wasm.d.ts')) {
        return 'export const grandbouleinstance_new: (a: number, b: number) => number;';
    }
    if (path.endsWith('.d.ts')) {
        return `export class GrandBouleInstance {
            constructor(sample_rate: number, voice_count: number);
        }`;
    }
    return `export class GrandBouleInstance {
        constructor(sample_rate, voice_count) {
            const ret = wasm.grandbouleinstance_new(sample_rate, voice_count);
        }
    }`;
}

function writeDistributedWasmFixture(root: string, binaryExport = 'allowed_instance_new'): void {
    for (const path of repositoryDistributedArtifacts.textArtifacts) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(
            join(root, path),
            repositoryDawDspArtifacts.has(path) && !path.endsWith('/package.json')
                ? grandBouleTextConstructorFixture(path)
                : 'export class AllowedInstance {}'
        );
    }
    for (const path of repositoryDistributedArtifacts.wasmArtifacts) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(
            join(root, path),
            wasmWithFunctionExport(repositoryDawDspArtifacts.has(path) ? 'grandbouleinstance_new' : binaryExport)
        );
    }
    mkdirSync(join(root, 'public/wasm'), { recursive: true });
    writeFileSync(
        join(root, 'public/wasm/manifest.json'),
        JSON.stringify({
            comment: 'fixture',
            toolchain: { wasmPack: 'fixture', wasmBindgen: 'fixture', rustToolchain: 'fixture', wasmOpt: 'fixture' },
            packages: Object.fromEntries(
                wasmArtifacts.packages.map((entry) => [
                    entry.id,
                    {
                        crate: entry.crateDir,
                        crateSourceHash: 'sha256:fixture',
                        schemaHash: 'fixture',
                        artifacts: Object.fromEntries(entry.artifacts.map((path) => [path, 'sha256:fixture'])),
                    },
                ])
            ),
        })
    );
}

function writeGrandBouleReleaseFixture(root: string): void {
    for (const [path, contents] of [
        [
            'crates/daw-dsp/src/grand_boule/engine.rs',
            `struct GrandBouleEngine {}
impl GrandBouleEngine {
    pub fn new(sample_rate: f32, voice_count: usize) -> Self {
        Self {
            hammer_hardness_scale: 0.92,
            hammer_mass_scale: 1.08,
            soundboard_brightness: 0.48,
            sympathetic_level: 0.58,
            body_resonance: 0.52,
            tone_color: -0.08,
        }
    }
}`,
        ],
        ['crates/daw-dsp/src/grand_boule/attack_sampler.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/duplex.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/hammer.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/longitudinal.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/mechanical_noise.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/midi2.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/mod.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/pedals.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/radiation.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/string.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/sympathetic.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/voice.rs', 'project source'],
        [
            'crates/daw-dsp/src/grand_boule/soundboard.rs',
            `const FIR_STAGE_COUNT: usize = 12;
struct FeedForwardDelay {}
const WARM_LEFT: KernelSpec = KernelSpec {};
const WARM_RIGHT: KernelSpec = KernelSpec {};
const OPEN_LEFT: KernelSpec = KernelSpec {};
const OPEN_RIGHT: KernelSpec = KernelSpec {};
fn tick() { input + delayed * self.delayed_gain; }`,
        ],
        [
            'crates/daw-dsp/src/grand_boule/parameters.rs',
            `//! Project tuning curves and standard piano mappings for Grand Boule.
fn curve(key: u32) {
    let t = ((key as f32 - 1.0) / 87.0).clamp(0.0, 1.0);
    let exponent = 7.86_f32 + 1.88 * t.powf(1.32) + 0.14 * t * (1.0 - t);
}`,
        ],
        [
            'crates/daw-dsp/src/grand_boule/coupled_strings.rs',
            `//! No body or soundboard property enters string coefficient derivation.
struct PolarizationDecay { prompt_hz: f32, aftersound_hz: f32 }
const POLARIZATION_TRANSFER_GAIN: f32 = 30.0;
const AFTERSOUND_MIX: f32 = 0.7;
fn polarization_decay_hz(note_frequency_hz: f32) -> PolarizationDecay {
    let register = note_frequency_hz;
    PolarizationDecay {
        prompt_hz: 0.58 + 0.72 * register + 7.2 * register.powf(2.4),
        aftersound_hz: 0.012 + 0.025 * register + 0.105 * register * register,
    }
}`,
        ],
        ['src/modules/GrandBoule/models/GrandBouleConfig.ts', 'export type GrandBouleConfig = {};'],
        [
            'src/modules/GrandBoule/models/GrandBouleMorphState.ts',
            `export const voicings = [
                { id: 'balanced-grand', name: 'Balanced Grand', hammerHardnessScale: 0.92, hammerMassScale: 1.08, soundboardBrightness: 0.48, sympatheticLevel: 0.58, bodyResonance: 0.52, toneColor: -0.08
                },
                { id: 'mellow-grand', name: 'Mellow Grand', hammerHardnessScale: 0.72, hammerMassScale: 1.25, soundboardBrightness: 0.32, sympatheticLevel: 0.74, bodyResonance: 0.82, toneColor: -0.58
                },
                { id: 'clear-grand', name: 'Clear Grand', hammerHardnessScale: 1.34, hammerMassScale: 0.82, soundboardBrightness: 0.78, sympatheticLevel: 0.36, bodyResonance: 0.42, toneColor: 0.56
                },
                { id: 'singing-grand', name: 'Singing Grand', hammerHardnessScale: 1.12, hammerMassScale: 0.94, soundboardBrightness: 0.68, sympatheticLevel: 0.66, bodyResonance: 0.57, toneColor: 0.28
                },
            ];
            `,
        ],
        [
            'src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts',
            "export const GRAND_BOULE_DESCRIPTOR = { id: 'grand-boule' };",
        ],
        ['src/infra/release/deviceReleaseAdmission.ts', 'export const withheld = new Set<string>();'],
        ['src/modules/AudioEngine/engine/GrandBouleNode.ts', 'export class GrandBouleNode {}'],
        ['src/modules/AudioEngine/models/GrandBouleRingProtocol.ts', 'export const ring = 1;'],
        ['src/modules/AudioEngine/workers/grandBouleEngineWorker.ts', 'export const worker = 1;'],
        ['src/modules/AudioEngine/worklets/grandBouleEngineCore.ts', 'export const core = 1;'],
        ['src/modules/AudioEngine/worklets/grandBouleProcessor.ts', 'export const processor = 1;'],
        ['.agents/decisions/0036-readmit-grand-boule.md', '# Grand Boule admission'],
        ['src/modules/Arrangement/useCases/preset/sidebarInstrumentPresets.ts', 'export const presets = [];'],
        ['src/modules/ContentBrowser/presentations/views/Sidebar/InstrumentsTab.tsx', 'export const tab = 1;'],
        [
            'src/modules/AudioEngine/repositories/deviceStrategy/nativeDspDeviceFactories.ts',
            'export const factories = 1;',
        ],
        [
            'src/modules/AudioEngine/repositories/deviceStrategy/unrenderableCatalogDeviceTypes.ts',
            'export const types = 1;',
        ],
        ['src/utils/nativeDspDeviceTypes.ts', 'export const types = 1;'],
        ['src/modules/AudioEngine/engine/wasmDeviceRegistry.ts', 'export const registry = 1;'],
        ['src/modules/AudioEngine/models/AudioEngineState.ts', 'export const state = 1;'],
        ['src/modules/AudioEngine/repositories/createWebAudioEngine.ts', 'export const engine = 1;'],
        ['src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts', 'export const schedule = 1;'],
        ['src/app/bootstrap.ts', 'export const bootstrap = 1;'],
        ['src/app/getProductionCommandHandlerMaps.ts', 'export const handlers = 1;'],
        ['src/utils/handlerContract.ts', 'export type Action = unknown;'],
        ['src/modules/Command/useCases/versionedCommandArgumentKeys.ts', 'export const keys = [];'],
        ['src/modules/Arrangement/useCases/index.ts', 'export const arrangement = 1;'],
        ['src/modules/Arrangement/useCases/device/setDeviceState.ts', 'export const setDeviceState = 1;'],
        ['src/app/prepareOfflineDeviceSetup.ts', 'export const offline = 1;'],
        ['src/modules/AudioEngine/useCases/buildDeviceChain.ts', 'export const chain = 1;'],
        ['src/modules/GrandBoule/useCases/prepareOfflineGrandBoule.ts', 'export const prepare = 1;'],
        ['crates/daw-dsp/benches/quantum.rs', 'fn grand_boule() {}'],
        ['crates/daw-dsp/benches/wasm/deviceRecipes.js', 'export const grandBoule = 1;'],
        ['crates/daw-dsp/benches/wasm/quantumCostProcessor.js', 'export const processor = 1;'],
        ['crates/daw-dsp/benches/wasm/run.mjs', 'export const runner = 1;'],
        ['crates/daw-dsp/benches/wasm/renderTable.mjs', 'export const renderer = 1;'],
        ['crates/daw-dsp/benches/wasm/renderTable.d.mts', 'export function renderGeneratedRegion(): string;'],
        ['crates/daw-dsp/benches/quantum-cost-table.json', '{}'],
        ['crates/daw-dsp/benches/quantum-cost-table.md', '# retained measurement'],
        ['crates/daw-dsp/tests/quantum_bench_census.rs', 'fn census() {}'],
        ['scripts/checkReleaseInventory.ts', 'export const check = 1;'],
    ] as const) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), contents);
    }
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
}

function writeGrandBouleMeasurementFixture(root: string): { jsonPath: string; revision: string } {
    const sourcePaths = [
        'crates/daw-dsp/benches/quantum.rs',
        'crates/daw-dsp/benches/wasm/deviceRecipes.js',
        'crates/daw-dsp/benches/wasm/quantumCostProcessor.js',
        'public/wasm/daw-dsp/daw_dsp_bg.wasm',
    ];
    for (const path of sourcePaths) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), `measured source ${path}`);
    }
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
        'git',
        ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'source'],
        {
            cwd: root,
        }
    );
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const sourceDigests = Object.fromEntries(
        sourcePaths.map((path) => [
            path,
            createHash('sha256')
                .update(readFileSync(join(root, path)))
                .digest('hex'),
        ])
    );
    const detail = 'active_voices() = 64, expected 64 from 64 note-ons, output RMS 1.000e-1';
    const data = {
        machine: {
            cpu: 'Fixture CPU',
            hardwareModel: 'Fixture Model',
            performanceCores: '4',
            efficiencyCores: '0',
            memoryGb: 16,
            os: 'Fixture OS',
            arch: 'arm64',
            gitBase: 'fixture-base',
            workingTree: 'clean',
            logicalCores: 4,
            gitSha: revision,
            takenAt: '2026-08-23T00:00:00.000Z',
        },
        sourceRevision: revision,
        sourceDigests,
        browser: 'fixture-browser',
        userAgent: 'fixture-agent',
        budgetMs: 2.666,
        options: { warmupQuanta: 4, measureQuanta: 8 },
        load: { before: 1.25, after: 1.5 },
        referenceProject: {
            audioThread: [['grand_boule_ring_consumer', 1]],
            worker: [['grand_boule', 1]],
            audioFloorMs: 0.1,
            audioFloorPartialFrom: [],
            audioUpperBoundMs: 1,
            audioWorstQuantumUpperMs: 2.1,
            audioMedianMs: 0.9,
            meanLoad: 1.5,
            workerFloorMs: 1.8,
            workerMedianMs: 2.2,
        },
        rows: [
            {
                id: 'grand_boule',
                label: 'Grand Boule (64 voices) — production Worker cost site',
                note: 'fixture',
                costSite: 'worker',
                warmVerify: { ok: true, detail },
                lateVerify: { ok: true, detail },
                stats: { median: 2.125, floor: 1.875, min: 1.8 },
                load: { mean: 1.5 },
                zeroFraction: 0,
                stationary: true,
                floorMeasurable: true,
                dutyCycle: null,
                calibration: { segments: 1, medianTicksPerMs: 1000, spreadPct: 0 },
                wallRatio: 0.8,
            },
        ],
    };
    const jsonPath = join(root, 'crates/daw-dsp/benches/quantum-cost-table.json');
    const markdownPath = join(root, 'crates/daw-dsp/benches/quantum-cost-table.md');
    writeFileSync(jsonPath, JSON.stringify(data));
    writeFileSync(markdownPath, renderGeneratedRegion(data));
    return { jsonPath, revision };
}

function inventory(): ReleaseInventory {
    return {
        schemaVersion: 1,
        surfaces: [
            {
                id: 'runtime',
                kind: 'source',
                retention: 'keep',
                owner: 'OS-01',
                releaseModes: ['source'],
                paths: ['public/**', 'src/**', ...REQUIRED_SNAPSHOT_PATHS],
                sources: ['git:example/repository'],
                revisions: ['deadbeef'],
                digests: ['sha256:example'],
                licenses: ['Apache-2.0'],
                productSurfaces: ['source distribution'],
                evidence: ['package.json'],
                obligations: ['Preserve attribution.'],
            },
        ],
        snapshots: REQUIRED_SNAPSHOT_PATHS.map((path) => ({ path, sha256: fixtureDigest })),
        externalReferences: [{ surface: 'runtime', file: 'src/provider.ts', value: 'https://provider.example/v1' }],
        marks: [],
    };
}

function snapshot(): RepositorySnapshot {
    return {
        releaseFiles: [...new Set([...REQUIRED_SNAPSHOT_PATHS, 'public/icon.png', 'src/provider.ts'])],
        externalReferences: [{ file: 'src/provider.ts', value: 'https://provider.example/v1' }],
        fileDigests: Object.fromEntries(REQUIRED_SNAPSHOT_PATHS.map((path) => [path, fixtureDigest])),
        markPaths: {},
    };
}

describe('release inventory', () => {
    it('includes the complete Grand Boule Rust module in the wasm32 crate graph', () => {
        expect(() => assertGrandBouleRustWasmBoundary(repositoryRoot)).not.toThrow();

        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-rust-boundary-'));
        try {
            const lib = join(root, 'crates/daw-dsp/src/lib.rs');
            mkdirSync(dirname(lib), { recursive: true });
            writeFileSync(lib, '#[cfg(not(target_arch = "wasm32"))]\npub mod grand_boule;\n');
            expect(() => assertGrandBouleRustWasmBoundary(root)).toThrow(
                'Grand Boule must be included in the wasm32 crate graph at crates/daw-dsp/src/lib.rs'
            );
            writeFileSync(lib, 'pub mod grand_boule;\npub mod grand_boule;\n');
            expect(() => assertGrandBouleRustWasmBoundary(root)).toThrow(
                'Grand Boule must be included in the wasm32 crate graph at crates/daw-dsp/src/lib.rs'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('pins the Grand Boule FIR body and neutral project provenance source shape', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-design-around-'));
        writeGrandBouleReleaseFixture(root);

        try {
            expect(() => assertGrandBouleDesignAroundSource(root)).not.toThrow();

            const soundboardPath = join(root, 'crates/daw-dsp/src/grand_boule/soundboard.rs');
            const soundboardSource = readFileSync(soundboardPath, 'utf8');
            writeFileSync(soundboardPath, 'const SOUNDBOARD_MODES: usize = 192; fn rebuild_modes() {}');
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('Grand Boule FIR body contract');

            writeFileSync(soundboardPath, soundboardSource);
            writeFileSync(
                join(root, 'src/modules/GrandBoule/models/GrandBouleMorphState.ts'),
                `export const model = { id: 'balanced-grand', name: 'Steinway Model D' };`
            );
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('product voicing contract');

            writeGrandBouleReleaseFixture(root);
            writeFileSync(
                join(root, 'crates/daw-dsp/src/grand_boule/coupled_strings.rs'),
                'fn sigma_bridge_hz(fundamental_hz: f32) -> f32 { 0.8 + fundamental_hz * 0.004 }'
            );
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('polarization-decay');

            writeGrandBouleReleaseFixture(root);
            writeFileSync(
                join(root, 'crates/daw-dsp/src/grand_boule/parameters.rs'),
                '//! Project tuning curves and standard piano mappings\nfn curve(key: u32) { let exponent = 8.0_f32 + 0.020 * (key as f32 - 1.0); }'
            );
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('hammer-stiffness');

            writeGrandBouleReleaseFixture(root);
            const voicingsPath = join(root, 'src/modules/GrandBoule/models/GrandBouleMorphState.ts');
            writeFileSync(
                voicingsPath,
                readFileSync(voicingsPath, 'utf8').replace(
                    'hammerHardnessScale: 0.92, hammerMassScale: 1.08, soundboardBrightness: 0.48, sympatheticLevel: 0.58, bodyResonance: 0.52, toneColor: -0.08',
                    'hammerHardnessScale: 1, hammerMassScale: 1, soundboardBrightness: 0.55, sympatheticLevel: 0.5, bodyResonance: 0.6, toneColor: 0'
                )
            );
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('legacy branded tuple');

            writeGrandBouleReleaseFixture(root);
            writeFileSync(voicingsPath, `${readFileSync(voicingsPath, 'utf8')}\nconst oldId = 'steinway-d';\n`);
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('legacy branded id');

            writeGrandBouleReleaseFixture(root);
            const enginePath = join(root, 'crates/daw-dsp/src/grand_boule/engine.rs');
            writeFileSync(
                enginePath,
                `// hammer_hardness_scale: 0.92, hammer_mass_scale: 1.08
                 const DECOY: &str = "soundboard_brightness: 0.48";
                 struct GrandBouleEngine {}
                 impl GrandBouleEngine {
                   pub fn new(sample_rate: f32, voice_count: usize) -> Self {
                     Self { hammer_hardness_scale: 1.0, hammer_mass_scale: 1.0, soundboard_brightness: 0.55,
                       sympathetic_level: 0.5, body_resonance: 0.6, tone_color: 0.0 }
                   }
                 }`
            );
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('Rust constructor');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('exposes Grand Boule construction from every distributed daw-dsp WASM surface', () => {
        expect(() => assertGrandBouleReleasedInWasm(repositoryRoot)).not.toThrow();
    });

    it.each(
        repositoryDistributedArtifacts.textArtifacts.filter(
            (path) => repositoryDawDspArtifacts.has(path) && !path.endsWith('/package.json')
        )
    )('rejects a missing Grand Boule construction path in declared daw-dsp text artifact %s', (path) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-text-'));

        try {
            writeDistributedWasmFixture(root);
            writeFileSync(join(root, path), 'export class AllowedInstance {}');
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                `Grand Boule constructor must be exposed exactly by distributed daw-dsp WASM surface ${path}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(
        repositoryDistributedArtifacts.textArtifacts.filter(
            (path) => repositoryDawDspArtifacts.has(path) && !path.endsWith('/package.json')
        )
    )('rejects a Grand Boule marker without the exact constructor in %s', (path) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-marker-'));
        try {
            writeDistributedWasmFixture(root);
            writeFileSync(join(root, path), 'export const marker = "GrandBouleInstance grandbouleinstance_new";');
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                `Grand Boule constructor must be exposed exactly by distributed daw-dsp WASM surface ${path}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(
        repositoryDistributedArtifacts.textArtifacts.filter(
            (path) =>
                repositoryDawDspArtifacts.has(path) &&
                !path.endsWith('/package.json') &&
                !path.endsWith('_bg.wasm.d.ts')
        )
    )('rejects a Grand Boule class whose constructor text belongs to a decoy class in %s', (path) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-decoy-'));
        try {
            writeDistributedWasmFixture(root);
            writeFileSync(
                join(root, path),
                path.endsWith('.d.ts')
                    ? `export class GrandBouleInstance {}
                       export class Decoy { constructor(sample_rate: number, voice_count: number); }`
                    : `export class GrandBouleInstance {}
                       export class Decoy {
                           constructor(sample_rate, voice_count) {
                               const ret = wasm.grandbouleinstance_new(sample_rate, voice_count);
                           }
                       }`
            );
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                `Grand Boule constructor must be exposed exactly by distributed daw-dsp WASM surface ${path}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(
        repositoryDistributedArtifacts.textArtifacts.filter(
            (path) => repositoryDawDspArtifacts.has(path) && path.endsWith('.js')
        )
    )('rejects unreachable or nested constructor calls in %s', (path) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-unreachable-'));
        try {
            writeDistributedWasmFixture(root);
            writeFileSync(
                join(root, path),
                `export class GrandBouleInstance {
                    constructor(sample_rate, voice_count) {
                        return;
                        if (false) wasm.grandbouleinstance_new(sample_rate, voice_count);
                    }
                }`
            );
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                `Grand Boule constructor must be exposed exactly by distributed daw-dsp WASM surface ${path}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(repositoryDistributedArtifacts.wasmArtifacts.filter((path) => repositoryDawDspArtifacts.has(path)))(
        'rejects a missing Grand Boule export in declared daw-dsp binary artifact %s',
        (path) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-binary-'));

            try {
                writeDistributedWasmFixture(root);
                writeFileSync(join(root, path), wasmWithFunctionExport('allowed_instance_new'));
                expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                    `Grand Boule constructor export must be exposed by distributed daw-dsp WASM binary ${path}`
                );
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it.each(repositoryDistributedArtifacts.wasmArtifacts.filter((path) => repositoryDawDspArtifacts.has(path)))(
        'rejects a marker-only Grand Boule binary export in %s',
        (path) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-binary-marker-'));
            try {
                writeDistributedWasmFixture(root);
                writeFileSync(join(root, path), wasmWithFunctionExport('grandbouleinstance_marker'));
                expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                    `Grand Boule constructor export must be exposed by distributed daw-dsp WASM binary ${path}`
                );
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it.each([
        ['public/wasm/hostile-extra.js', 'export class GrandBouleInstance {}', 'distributed public WASM tree'],
        [
            'public/wasm/proof-chamber/nested/hostile-extra.wasm',
            wasmWithFunctionExport('grandbouleinstance_new'),
            'distributed public WASM tree',
        ],
        [
            'src/modules/AudioEngine/wasm/hostile-extra.js',
            'export class GrandBouleInstance {}',
            'distributed AudioEngine WASM mirror',
        ],
        [
            'src/modules/AudioEngine/wasm/nested/hostile-extra.wasm',
            wasmWithFunctionExport('grandbouleinstance_new'),
            'distributed AudioEngine WASM mirror',
        ],
        [
            'src/modules/AudioEngine/wasm/__tests__/hostile-extra.js',
            'export class GrandBouleInstance {}',
            'distributed AudioEngine WASM mirror',
        ],
        [
            'src/modules/AudioEngine/wasm/__tests__/hostile-extra.wasm',
            wasmWithFunctionExport('grandbouleinstance_new'),
            'distributed AudioEngine WASM mirror',
        ],
    ])('rejects unmanifested distributed sidecar %s', (path, contents, label) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-'));

        try {
            writeDistributedWasmFixture(root);
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), contents);
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(`${label} has unexpected artifact ${path}`);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects unexpected manifest packages and artifact paths before scanning their bytes', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-manifest-'));

        try {
            writeDistributedWasmFixture(root);
            const manifestPath = join(root, 'public/wasm/manifest.json');
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WasmManifest;
            manifest.packages.hostile = {
                crate: 'crates/hostile',
                crateSourceHash: 'sha256:fixture',
                schemaHash: 'fixture',
                artifacts: {},
            };
            writeFileSync(manifestPath, JSON.stringify(manifest));
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow('WASM manifest has unexpected package hostile');

            writeDistributedWasmFixture(root);
            const changed = JSON.parse(readFileSync(manifestPath, 'utf8')) as WasmManifest;
            changed.packages['proof-chamber']!.artifacts['public/wasm/hostile.js'] = 'sha256:fixture';
            writeFileSync(manifestPath, JSON.stringify(changed));
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                'WASM manifest package proof-chamber has unexpected artifact public/wasm/hostile.js'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('composes both DDSP contracts directly from the release inventory registry', () => {
        const liveInventory = JSON.parse(
            readFileSync(join(repositoryRoot, 'release/open-source-inventory.json'), 'utf8')
        ) as ReleaseInventory;

        expect(() => assertDdspReleaseInventory(repositoryRoot, liveInventory)).not.toThrow();
        expect(() =>
            assertDdspReleaseInventory(repositoryRoot, {
                ...liveInventory,
                surfaces: liveInventory.surfaces.filter(({ id }) => id !== 'ddsp-models'),
            })
        ).toThrow('DDSP models release inventory kind does not match provenance');
    });

    it('keeps full live validation bound to Grand Boule source history before WASM verification', () => {
        const historyRequests: string[] = [];
        const stopAfterHistoryValidation = new Error('stop after Grand Boule history validation');

        expect(() =>
            checkReleaseInventory(repositoryRoot, {
                readGrandBouleSourceAtRevision(root, revision, path) {
                    historyRequests.push(`${revision}:${path}`);
                    return execFileSync('git', ['show', `${revision}:${path}`], { cwd: root });
                },
                verifyWasmArtifacts() {
                    throw stopAfterHistoryValidation;
                },
            })
        ).toThrow(stopAfterHistoryValidation);
        expect(historyRequests.map((request) => request.slice(request.indexOf(':') + 1))).toEqual(
            GRAND_BOULE_MEASUREMENT_SOURCE_PATHS
        );
    });

    it('binds admitted DDSP writes, rendering, exact artifacts, and reversal obligations', () => {
        const contract = ddspModelsReleaseInventoryContract(repositoryRoot);

        expect(contract.retention).toBe('keep-with-obligations');
        expect(contract.paths).toEqual(DDSP_MODEL_PATHS);
        expect(contract.paths).not.toContain('scripts/checkReleaseInventory.ts');
        expect(contract.paths).toEqual(
            expect.arrayContaining([
                'electron/protocol.ts',
                'src/modules/BrowserAi/repositories/stageDdspInstrumentGeneration.ts',
                'src/modules/BrowserAi/repositories/checkDdspInstrumentReady.ts',
                'src/modules/BrowserAi/repositories/cleanupUnpublishedDdspGeneration.ts',
                'src/modules/BrowserAi/repositories/ddspGenerationStorageSupport.ts',
                'src/modules/BrowserAi/repositories/modelStorageWorkerBridge.ts',
                'src/modules/BrowserAi/repositories/withDdspInstrumentLock.ts',
                'src/modules/BrowserAi/workers/modelStorageWorker.ts',
                'src/modules/BrowserAi/workers/modelStorageWorkerRuntime.ts',
                'src/modules/BrowserAi/repositories/removeDdspInstrumentGenerations.ts',
                'src/modules/BrowserAi/useCases/removeDdspInstrument.ts',
                'src/modules/BrowserAi/useCases/downloadModel.ts',
                'src/modules/BrowserAi/useCases/removeModel.ts',
                'src/modules/BrowserAi/useCases/renderDdspInstrument.ts',
            ])
        );
        for (const path of ddspModelEnforcementPaths) {
            expect(contract.digests?.some((digest) => digest.endsWith(`:${path}`))).toBe(true);
        }
        expect(contract.digests?.filter((digest) => digest.includes(':bytes:'))).toHaveLength(12);
        expect(contract.licenses).toEqual(['unverified:exact-GCS-checkpoint-artifacts']);
        expect(contract.obligations).toEqual(
            expect.arrayContaining([
                expect.stringContaining('checkpoint license explicitly unverified'),
                expect.stringContaining('MODEL_RELEASE_ADMISSION.ddsp to false'),
                expect.stringContaining('exact Magenta DDSP source from electron/protocol.ts connect-src'),
                expect.stringContaining('remove its release inventory egress assignment'),
            ])
        );
    });

    it.each([DDSP_ADMISSION_DECISION_PATH, 'electron/protocol.ts', 'public/legal/THIRD-PARTY-NOTICES.md'])(
        'rejects admitted DDSP provenance drift in %s',
        (changedPath) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-ddsp-model-admission-'));
            const manifestPath = 'src/modules/BrowserAi/models/DdspArtifactManifest.ts';
            const manifest = `baseline:${manifestPath}`;
            writeDdspModelContractFixture(root, manifest);

            try {
                const admitted = ddspModelsReleaseInventoryContract(root);
                expect(() => assertDdspModelsReleaseInventory(root, admitted)).not.toThrow();

                writeFileSync(join(root, changedPath), `changed:${changedPath}`);
                expect(() => assertDdspModelsReleaseInventory(root, admitted)).toThrow(
                    changedPath === DDSP_ADMISSION_DECISION_PATH
                        ? 'ADR 0035 does not admit the current DDSP artifact manifest'
                        : 'DDSP models release inventory digests does not match provenance'
                );
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it.each([...DDSP_TFJS_APPLICATION_RUNTIME_PATHS])(
        'rejects drift in admitted DDSP TF.js runtime source %s',
        (changedPath) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-ddsp-tfjs-runtime-'));
            for (const path of DDSP_TFJS_RUNTIME_PATHS) {
                if (!path.startsWith('public/legal/') && !ddspTfjsApplicationRuntimePathSet.has(path)) {
                    continue;
                }
                mkdirSync(dirname(join(root, path)), { recursive: true });
                writeFileSync(join(root, path), `baseline:${path}`);
            }

            try {
                const before = ddspTfjsRuntimeReleaseInventoryContract(root);
                writeFileSync(join(root, changedPath), `changed runtime:${changedPath}`);

                expect(ddspTfjsRuntimeReleaseInventoryContract(root).digests).not.toEqual(before.digests);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it.each([
        'src/modules/BrowserAi/repositories/withDdspInstrumentLock.ts',
        'src/modules/BrowserAi/workers/modelStorageWorker.ts',
        'src/modules/BrowserAi/workers/modelStorageWorkerRuntime.ts',
        'src/infra/release/modelReleaseAdmission.ts',
        'src/modules/BrowserAi/useCases/renderDdspInstrument.ts',
        'src/modules/BrowserAi/useCases/removeDdspInstrument.ts',
        'src/modules/BrowserAi/useCases/downloadModel.ts',
        'src/modules/BrowserAi/useCases/removeModel.ts',
    ])('rejects drift in admitted DDSP enforcement %s', (changedPath) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-ddsp-enforcement-'));
        writeDdspModelContractFixture(root, 'admitted manifest');

        try {
            const admitted = ddspModelsReleaseInventoryContract(root);
            writeFileSync(join(root, changedPath), `changed enforcement:${changedPath}`);

            expect(() => assertDdspModelsReleaseInventory(root, admitted)).toThrow(
                'DDSP models release inventory digests does not match provenance'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a regenerated DDSP inventory when the manifest changes without a new admission decision', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-ddsp-manifest-anchor-'));
        const manifestPath = 'src/modules/BrowserAi/models/DdspArtifactManifest.ts';
        const manifest = 'admitted manifest';
        writeDdspModelContractFixture(root, manifest);

        try {
            const admitted = ddspModelsReleaseInventoryContract(root);
            const changedManifest = 'changed manifest and artifact identities';
            writeFileSync(join(root, manifestPath), changedManifest);
            const regenerated = {
                ...admitted,
                digests: admitted.digests?.map((digest) =>
                    digest.endsWith(`:${manifestPath}`) ? `sha256:${sha256(changedManifest)}:${manifestPath}` : digest
                ),
            };

            expect(() => assertDdspModelsReleaseInventory(root, regenerated)).toThrow(
                'ADR 0035 does not admit the current DDSP artifact manifest'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('keeps the public DDSP notice truthful about active downloads and the unverified checkpoint license', () => {
        const notice = readFileSync(join(repositoryRoot, 'public/legal/THIRD-PARTY-NOTICES.md'), 'utf8');

        expect(notice).not.toContain('release-withheld DDSP worker');
        expect(notice).not.toContain('product admission gate remains closed');
        expect(notice).toContain('checkpoint license remains unverified');
        expect(notice).toContain('does not bundle or redistribute');
    });

    it('binds the exact DDSP TF.js dependency and legal closure', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-ddsp-tfjs-provenance-'));
        for (const path of DDSP_TFJS_RUNTIME_PATHS) {
            if (!path.startsWith('public/legal/') && !ddspTfjsApplicationRuntimePathSet.has(path)) {
                continue;
            }
            mkdirSync(join(root, path, '..'), { recursive: true });
            writeFileSync(join(root, path), path);
        }

        try {
            const before = ddspTfjsRuntimeReleaseInventoryContract(root);
            expect(before.kind).toBe('runtime-library');
            expect(before.paths).toEqual(DDSP_TFJS_RUNTIME_PATHS);
            expect(before.revisions).toContain('@tensorflow/tfjs-backend-webgpu 4.22.0');
            expect(before.revisions).toContain('@tensorflow/tfjs-backend-cpu 4.22.0 shared helpers only');
            expect(before.licenses).toEqual([
                'Apache-2.0:TensorFlow.js',
                'Apache-2.0:long',
                'Apache-2.0:Magenta.js-Roll-adaptation',
                'MIT:seedrandom-and-Alea',
            ]);

            writeFileSync(join(root, 'public/legal/TensorFlow.js-NOTICE.txt'), 'changed');
            expect(ddspTfjsRuntimeReleaseInventoryContract(root).digests).not.toEqual(before.digests);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds Grand Boule source bytes to its inventory digest', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-provenance-'));
        writeGrandBouleReleaseFixture(root);
        const grandBoule = join(root, 'crates/daw-dsp/src/grand_boule');

        try {
            const before = grandBouleReleaseInventoryContract(root);
            expect(before.retention).toBe('keep');
            expect(before.releaseModes).toEqual(['source', 'web', 'desktop']);
            expect(before.paths).toEqual(GRAND_BOULE_RELEASE_REGISTRY.boundaries.flatMap(({ paths }) => [...paths]));
            expect(before.paths).toContain('src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts');
            expect(before.paths).toContain('src/modules/Arrangement/useCases/device/setDeviceState.ts');
            expect(before.paths).toContain('src/infra/release/deviceReleaseAdmission.ts');
            expect(before.paths).toContain('src/modules/AudioEngine/worklets/grandBoule*.ts');
            expect(before.paths).not.toContain('src/modules/AudioEngine/worklets/**');
            expect(before.productSurfaces).toEqual(['Grand Boule source, browser WASM, and desktop runtime']);
            expect(before.digests).toHaveLength(GRAND_BOULE_RELEASE_REGISTRY.boundaries.length);
            expect(before.digests).toEqual(
                GRAND_BOULE_RELEASE_REGISTRY.boundaries.map(({ digestLabel }) =>
                    expect.stringMatching(new RegExp(`^tracked-set-sha256:[0-9a-f]{64}:${digestLabel}$`))
                )
            );

            writeFileSync(join(grandBoule, 'untracked.rs'), 'untracked source');
            expect(grandBouleReleaseInventoryContract(root).digests).toEqual(before.digests);

            writeFileSync(join(grandBoule, 'engine.rs'), 'changed source');
            expect(grandBouleReleaseInventoryContract(root).digests).not.toEqual(before.digests);

            writeFileSync(
                join(root, 'src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts'),
                'changed descriptor'
            );
            expect(grandBouleReleaseInventoryContract(root).digests).not.toEqual(before.digests);

            const representatives = [
                'crates/daw-dsp/src/grand_boule/engine.rs',
                '.agents/decisions/0036-readmit-grand-boule.md',
                'src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts',
                'src/infra/release/deviceReleaseAdmission.ts',
                'src/modules/AudioEngine/engine/GrandBouleNode.ts',
                'src/modules/GrandBoule/models/GrandBouleConfig.ts',
                'src/modules/Command/useCases/versionedCommandArgumentKeys.ts',
                'src/modules/Arrangement/useCases/index.ts',
                'src/modules/Arrangement/useCases/device/setDeviceState.ts',
                'src/app/prepareOfflineDeviceSetup.ts',
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
            ];
            writeGrandBouleReleaseFixture(root);
            const baseline = grandBouleReleaseInventoryContract(root).digests;
            for (const [index, path] of representatives.entries()) {
                const absolute = join(root, path);
                const original = readFileSync(absolute, 'utf8');
                writeFileSync(absolute, `${original}\nmutation-${index}`);
                const changed = grandBouleReleaseInventoryContract(root).digests;
                const boundaryIndex = GRAND_BOULE_RELEASE_REGISTRY.boundaries.findIndex(({ gitPathspecs }) =>
                    gitPathspecs.some((pathspec) => {
                        const normalized = pathspec.replace(/^:\(glob\)/u, '').replace(/\/\*\*$/u, '');
                        return path === normalized || path.startsWith(`${normalized}/`);
                    })
                );
                expect(
                    changed.flatMap((digest, changedIndex) => (digest === baseline[changedIndex] ? [] : [changedIndex]))
                ).toEqual([boundaryIndex]);
                writeFileSync(absolute, original);
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects every tracked Rust file without an admission basis', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-source-gap-'));
        try {
            writeGrandBouleReleaseFixture(root);
            const unsupported = join(root, 'crates/daw-dsp/src/grand_boule/unsupported.rs');
            writeFileSync(unsupported, 'project source');
            execFileSync('git', ['add', 'crates/daw-dsp/src/grand_boule/unsupported.rs'], { cwd: root });
            expect(() => assertGrandBouleRustSourceAdmission(root)).toThrow('unsupported attribution gap');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds the measured row to exact voice proof, source bytes, revision, and Markdown', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-measurement-'));
        try {
            const { jsonPath } = writeGrandBouleMeasurementFixture(root);
            expect(() => assertGrandBouleMeasurementAdmission(root)).not.toThrow();

            const measuredSourcePath = join(root, 'crates/daw-dsp/benches/quantum.rs');
            const originalSource = readFileSync(measuredSourcePath, 'utf8');
            writeFileSync(measuredSourcePath, `${originalSource}\ncurrent source mutation`);
            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow('source digest drifted');
            writeFileSync(measuredSourcePath, originalSource);

            const original = readFileSync(jsonPath, 'utf8');
            const unresolvedRevision = 'f'.repeat(40);
            const unresolved = JSON.parse(original) as {
                sourceRevision: string;
                machine: { gitSha: string };
            };
            unresolved.sourceRevision = unresolvedRevision;
            unresolved.machine.gitSha = unresolvedRevision;
            writeFileSync(jsonPath, JSON.stringify(unresolved));
            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow(
                `source revision ${unresolvedRevision} cannot provide crates/daw-dsp/benches/quantum.rs`
            );

            const data = JSON.parse(original) as {
                sourceDigests: Record<string, string>;
                rows: Array<{ warmVerify: { detail: string } }>;
            };
            data.rows[0]!.warmVerify.detail = 'active_voices() = 63, expected 64';
            writeFileSync(jsonPath, JSON.stringify(data));
            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow('exactly 64 active voices');

            const changed = JSON.parse(original) as {
                sourceDigests: Record<string, string>;
            };
            changed.sourceDigests['crates/daw-dsp/benches/quantum.rs'] = '0'.repeat(64);
            writeFileSync(jsonPath, JSON.stringify(changed));
            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow(
                'recorded digest does not match source revision'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects stale or decoy rounded measurement numbers in the generated Markdown region', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-measurement-render-'));
        try {
            const { jsonPath } = writeGrandBouleMeasurementFixture(root);
            const markdownPath = join(root, 'crates/daw-dsp/benches/quantum-cost-table.md');
            const originalMarkdown = readFileSync(markdownPath, 'utf8');

            writeFileSync(
                markdownPath,
                originalMarkdown.replace(
                    '| Audio thread, worst quantum, upper bound | 2.1 |',
                    '| Audio thread, worst quantum, upper bound | 9.9 |'
                )
            );
            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow(
                'generated region does not match JSON rendering'
            );

            writeFileSync(markdownPath, originalMarkdown);
            const data = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
                rows: Array<{ stats: { median: number } }>;
            };
            data.rows[0]!.stats.median = 1.125;
            writeFileSync(jsonPath, JSON.stringify(data));
            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow(
                'generated region does not match JSON rendering'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects stale Grand Boule revisions and digests through the Grand Boule assertion', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-assertion-'));
        writeGrandBouleReleaseFixture(root);

        try {
            const current = grandBouleReleaseInventoryContract(root);
            expect(() =>
                assertGrandBouleReleaseInventory(root, {
                    ...current,
                    revisions: ['stale tracked source'],
                })
            ).toThrow('Grand Boule release inventory revisions does not match provenance');
            expect(() =>
                assertGrandBouleReleaseInventory(root, {
                    ...current,
                    digests: ['tree-sha256:stale:crates/daw-dsp/src/grand_boule'],
                })
            ).toThrow('Grand Boule release inventory digests does not match provenance');

            for (const [field, value] of [
                ['retention', 'defer-behind-admission'],
                ['releaseModes', ['source']],
                ['paths', current.paths.slice(1)],
            ] as const) {
                expect(() => assertGrandBouleReleaseInventory(root, { ...current, [field]: value })).toThrow(
                    `Grand Boule release inventory ${field} does not match provenance`
                );
            }

            rmSync(join(root, 'src/modules/GrandBoule/models/GrandBouleConfig.ts'));
            expect(() => grandBouleReleaseInventoryContract(root)).toThrow(
                'Grand Boule release source is missing: src/modules/GrandBoule/models/GrandBouleConfig.ts'
            );

            writeGrandBouleReleaseFixture(root);
            const preserved = grandBouleReleaseInventoryContract(root);
            rmSync(join(root, 'src/infra/release/deviceReleaseAdmission.ts'));
            expect(() => grandBouleReleaseInventoryContract(root)).toThrow(
                'Grand Boule release source is missing: src/infra/release/deviceReleaseAdmission.ts'
            );

            writeGrandBouleReleaseFixture(root);
            rmSync(join(root, 'src/modules/AudioEngine/worklets/grandBouleProcessor.ts'));
            expect(() => assertGrandBouleReleaseInventory(root, preserved)).toThrow(
                'Grand Boule release source is missing: src/modules/AudioEngine/worklets/grandBouleProcessor.ts'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds owner-created visual assets and every derived rendition', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-'));
        mkdirSync(join(root, 'public/logo-parts'), { recursive: true });
        mkdirSync(join(root, 'build/icons/nested'), { recursive: true });
        for (const path of [
            'public/favicon.ico',
            'public/icon-192.png',
            'public/icon-transparent.png',
            'public/icon.png',
            'sourdaw.png',
            'public/logo-parts/p00.png',
            'build/icons/icon.png',
            'build/icons/nested/icon.png',
        ]) {
            writeFileSync(join(root, path), path);
        }

        try {
            const before = ownerVisualAssetReleaseInventoryContract(root);
            expect(before.kind).toBe('owner-created-asset');
            expect(before.paths).toEqual(OWNER_VISUAL_ASSET_PATHS);
            expect(before.sources).toContain('owner attestation: Jose Costa, 2026-08-21');
            expect(before.licenses).toEqual(['Apache-2.0']);

            writeFileSync(join(root, 'build/icons/nested/icon.png'), 'changed');
            expect(ownerVisualAssetReleaseInventoryContract(root).digests).not.toEqual(before.digests);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds the shipped trademark notice', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-trademark-notice-'));
        const legal = join(root, 'public/legal');
        mkdirSync(legal, { recursive: true });
        writeFileSync(join(root, TRADEMARK_NOTICE_PATH), 'notice');

        try {
            const before = trademarkReleaseInventoryContract(root);
            expect(TRADEMARK_NOTICE_PATH).toBe('public/legal/TRADEMARKS.md');
            expect(before.licenses).toEqual(['not-applicable:trademark-rights-not-granted']);

            writeFileSync(join(root, TRADEMARK_NOTICE_PATH), 'changed');
            expect(trademarkReleaseInventoryContract(root).digests).not.toEqual(before.digests);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds direct worklet source bytes without inventing a generator', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-worklet-provenance-'));
        const worklets = join(root, 'public/audio/worklets');
        mkdirSync(worklets, { recursive: true });
        writeFileSync(join(worklets, 'native-plugin-bridge-processor.js'), 'native');
        writeFileSync(join(worklets, 'sidechain-compressor-processor.js'), 'sidechain');

        try {
            const before = audioWorkletReleaseInventoryContract(root);
            expect(before.kind).toBe('project-source');
            expect(before.revisions).toEqual(['not-applicable:direct-project-source']);

            writeFileSync(join(worklets, 'native-plugin-bridge-processor.js'), 'changed');
            expect(audioWorkletReleaseInventoryContract(root).digests[0]).not.toBe(before.digests[0]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds the adapted MIT source and exact upstream license bytes', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-adapted-mit-'));
        mkdirSync(join(root, 'crates/daw-dsp/src/toaster/engines'), { recursive: true });
        mkdirSync(join(root, 'public/legal'), { recursive: true });
        mkdirSync(join(root, 'release/upstream-proofs'), { recursive: true });
        writeFileSync(join(root, ADAPTED_MIT_SOURCE_PATH), 'adapted source');
        writeFileSync(
            join(root, ADAPTED_MIT_LICENSE_PATH),
            readFileSync(join(repositoryRoot, ADAPTED_MIT_LICENSE_PATH))
        );
        writeFileSync(join(root, ADAPTED_ORIGINAL_MIT_LICENSE_PATH), 'original upstream license');
        writeFileSync(join(root, ADAPTED_MIT_NOTICE_PATH), 'public notice');
        writeFileSync(
            join(root, ADAPTED_MIT_UPSTREAM_PROOF_PATH),
            readFileSync(join(repositoryRoot, ADAPTED_MIT_UPSTREAM_PROOF_PATH))
        );
        writeFileSync(
            join(root, ADAPTED_MIT_LICENSE_PROOF_PATH),
            readFileSync(join(repositoryRoot, ADAPTED_MIT_LICENSE_PROOF_PATH))
        );
        writeFileSync(
            join(root, ADAPTED_ORIGINAL_UPSTREAM_PROOF_PATH),
            readFileSync(join(repositoryRoot, ADAPTED_ORIGINAL_UPSTREAM_PROOF_PATH))
        );

        try {
            const before = adaptedMitSourceReleaseInventoryContract(root);
            expect(before.licenses).toEqual(['MIT']);
            expect(before.revisions).toEqual([ADAPTED_MIT_COMMIT, ADAPTED_ORIGINAL_COMMIT]);
            expect(before.sources).toContain(
                `git:github.com/pichenettes/eurorack@${ADAPTED_ORIGINAL_COMMIT}:${ADAPTED_ORIGINAL_SOURCE_PATH}`
            );
            expect(before.digests).toContain(
                `sha256:${ADAPTED_ORIGINAL_SOURCE_SHA256}:git:github.com/pichenettes/eurorack@${ADAPTED_ORIGINAL_COMMIT}:${ADAPTED_ORIGINAL_SOURCE_PATH}`
            );
            expect(before.digests).toContain(
                `sha256:b2ec3cd241dd660bd4de9f07dd94ecce3ee9c696eaf15af7af68eae6ed4af04c:git:github.com/sourcebox/mi-plaits-dsp-rs@${ADAPTED_MIT_COMMIT}:LICENSE.txt`
            );

            writeFileSync(join(root, ADAPTED_MIT_LICENSE_PROOF_PATH), 'changed upstream license proof');
            expect(() => adaptedMitSourceReleaseInventoryContract(root)).toThrow(
                'pinned upstream license proof drifted'
            );
            writeFileSync(
                join(root, ADAPTED_MIT_LICENSE_PROOF_PATH),
                readFileSync(join(repositoryRoot, ADAPTED_MIT_LICENSE_PROOF_PATH))
            );

            writeFileSync(join(root, ADAPTED_MIT_SOURCE_PATH), 'changed');
            expect(adaptedMitSourceReleaseInventoryContract(root).digests[0]).not.toBe(before.digests[0]);

            writeFileSync(join(root, ADAPTED_ORIGINAL_MIT_LICENSE_PATH), 'changed original license');
            expect(adaptedMitSourceReleaseInventoryContract(root).digests[7]).not.toBe(before.digests[7]);

            writeFileSync(join(root, ADAPTED_MIT_NOTICE_PATH), 'changed public notice');
            expect(adaptedMitSourceReleaseInventoryContract(root).digests[8]).not.toBe(before.digests[8]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds the WASM manifest to its toolchain and crate closures', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-wasm-provenance-'));
        mkdirSync(join(root, 'public/wasm'), { recursive: true });
        writeFileSync(join(root, 'public/wasm/manifest.json'), '{}');
        const manifest: WasmManifest = {
            comment: 'fixture',
            toolchain: {
                wasmPack: '1',
                wasmBindgen: '2',
                rustToolchain: '3',
                wasmOpt: '4',
            },
            packages: {
                beta: { crate: 'crates/beta', crateSourceHash: 'sha256:beta', schemaHash: 'beta', artifacts: {} },
                alpha: { crate: 'crates/alpha', crateSourceHash: 'sha256:alpha', schemaHash: 'alpha', artifacts: {} },
            },
        };

        try {
            const contract = wasmReleaseInventoryContract(root, manifest);
            expect(contract.sources).toEqual(['crates/alpha/', 'crates/beta/']);
            expect(contract.revisions).toEqual([
                'rust 3',
                'wasm-pack 1',
                'wasm-bindgen 2',
                'wasm-opt 4',
                'alpha sha256:alpha',
                'beta sha256:beta',
            ]);
            expect(contract.digests).toEqual([
                expect.stringMatching(/^sha256:[0-9a-f]{64}:public\/wasm\/manifest\.json$/),
            ]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('keeps every served WASM package out of npm publication and rebuild scripts restore that state', () => {
        const scripts = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        for (const { id, buildScript } of wasmArtifacts.packages) {
            const metadata = JSON.parse(
                readFileSync(join(repositoryRoot, 'public/wasm', id, 'package.json'), 'utf8')
            ) as {
                private?: unknown;
                license?: unknown;
            };
            expect(metadata.private).toBe(true);
            expect(metadata.license).toBe('Apache-2.0');
            expect(scripts.scripts[buildScript]).toContain(`markWasmPackageInternal.ts ${id}`);
        }
    });

    it('accepts complete classified coverage', () => {
        expect(validateReleaseInventory(inventory(), snapshot())).toEqual([]);
    });

    it('rejects unresolved rights on a retained keep surface', () => {
        const value = inventory();
        value.surfaces[0]!.retention = 'keep';
        value.surfaces[0]!.licenses = ['Apache-2.0', 'unverified:unknown-rights'];

        expect(validateReleaseInventory(value, snapshot())).toContain(
            'runtime: keep surfaces cannot carry unverified rights'
        );
    });

    it('rejects duplicate inventory keys before JSON consumption', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-duplicate-inventory-'));
        try {
            mkdirSync(join(root, 'release'), { recursive: true });
            writeFileSync(join(root, 'release/open-source-inventory.json'), '{"surface":{"id":"one","id":"two"}}');
            expect(() => readReleaseInventory(root)).toThrow('duplicate key');
            writeFileSync(join(root, 'release/open-source-inventory.json'), '');
            expect(() => readReleaseInventory(root)).toThrow('invalid JSON');
            writeFileSync(join(root, 'release/open-source-inventory.json'), '{"surface":]');
            expect(() => readReleaseInventory(root)).toThrow('invalid JSON');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds the project-license distribution surface to generated legal evidence', () => {
        const contract = projectLicenseDistributionReleaseInventoryContract(repositoryRoot);
        expect(contract.paths).toContain('release/dependency-license-proofs.json');
        expect(contract.paths).toContain('release/upstream-proofs/**');
        expect(
            contract.digests.some((digest) =>
                /^sha256:[0-9a-f]{64}:public\/legal\/DEPENDENCY-LICENSES\.txt$/u.test(digest)
            )
        ).toBe(true);
        const surface = readReleaseInventory(repositoryRoot).surfaces.find(
            (candidate) => candidate.id === 'project-license-distribution'
        );
        expect(() => assertProjectLicenseDistributionReleaseInventory(repositoryRoot, surface)).not.toThrow();
        expect(() =>
            assertProjectLicenseDistributionReleaseInventory(repositoryRoot, {
                ...(surface ?? {}),
                digests: ['sha256:stale:LICENSE'],
            })
        ).toThrow('project license distribution release inventory digests does not match provenance');
    });

    it('rejects a new release file without a classification', () => {
        expect(
            validateReleaseInventory(inventory(), {
                ...snapshot(),
                releaseFiles: [...snapshot().releaseFiles, 'electron/sidecar/new.bin'],
            })
        ).toContain('unclassified release files:\n- electron/sidecar/new.bin');
    });

    it('rejects a new endpoint in an already-owned file', () => {
        expect(
            validateReleaseInventory(inventory(), {
                ...snapshot(),
                externalReferences: [
                    ...snapshot().externalReferences,
                    { file: 'src/provider.ts', value: 'https://second.example/v1' },
                ],
            })
        ).toContain('external references missing from inventory:\n- src/provider.ts -> https://second.example/v1');
    });

    it('rejects stale endpoint assignments', () => {
        expect(validateReleaseInventory(inventory(), { ...snapshot(), externalReferences: [] })).toContain(
            'stale external-reference assignments:\n- src/provider.ts -> https://provider.example/v1'
        );
    });

    it('rejects endpoint assignments to an unrelated surface', () => {
        const value = inventory();
        value.surfaces.push({ ...value.surfaces[0]!, id: 'docs', paths: ['docs/**'] });
        value.externalReferences[0]!.surface = 'docs';

        expect(validateReleaseInventory(value, snapshot())).toContain(
            'src/provider.ts: docs does not cover the referenced file'
        );
    });

    it('does not let a directory rule swallow a sibling prefix', () => {
        expect(
            validateReleaseInventory(inventory(), {
                ...snapshot(),
                releaseFiles: [...snapshot().releaseFiles, 'publicity/icon.png'],
            })
        ).toContain('unclassified release files:\n- publicity/icon.png');
    });

    it('rejects unclassified retention', () => {
        const value = inventory();
        value.surfaces[0]!.retention = 'unclassified' as never;

        expect(validateReleaseInventory(value, snapshot())).toContain('runtime: invalid retention class unclassified');
    });

    it('rejects removal of a required snapshot', () => {
        const value = inventory();
        value.snapshots = value.snapshots.filter((entry) => entry.path !== 'pnpm-lock.yaml');

        expect(validateReleaseInventory(value, snapshot())).toContain(
            'required snapshots missing from inventory:\n- pnpm-lock.yaml'
        );
    });

    it('binds every dependency lock digest to its owning surface snapshot', () => {
        const value = inventory();
        for (const id of ['javascript-dependencies', 'collaboration-server', 'rust-dependencies']) {
            value.surfaces.push({ ...value.surfaces[0]!, id, digests: ['sha256:stale'] });
        }

        expect(validateReleaseInventory(value, snapshot())).toEqual(
            expect.arrayContaining([
                `javascript-dependencies: digest must match pnpm-lock.yaml snapshot (sha256:${fixtureDigest})`,
                `javascript-dependencies: digest must match server/package-lock.json snapshot (sha256:${fixtureDigest})`,
                `collaboration-server: digest must match server/package-lock.json snapshot (sha256:${fixtureDigest})`,
                `rust-dependencies: digest must match Cargo.lock snapshot (sha256:${fixtureDigest})`,
            ])
        );
    });

    it('runs the project-license preflight before loading the inventory', () => {
        let called = false;

        expect(() =>
            checkReleaseInventory('/inventory-is-not-read', () => {
                called = true;
                throw new Error('project license preflight sentinel');
            })
        ).toThrow('project license preflight sentinel');
        expect(called).toBe(true);
    });

    it('rejects snapshots outside the tracked repository', () => {
        const value = inventory();
        value.snapshots.push({ path: 'untracked.lock', sha256: fixtureDigest });

        expect(validateReleaseInventory(value, snapshot())).toContain('untracked.lock: snapshot path must be tracked');
    });

    it('rejects missing required marks and empty mark assignments', () => {
        const value = inventory();
        value.marks = [{ value: 'Neve', paths: [] }];

        expect(validateReleaseInventory(value, snapshot(), ['Roland'])).toEqual(
            expect.arrayContaining([
                'required marks missing from inventory:\n- Roland',
                'Neve: paths must be non-empty',
            ])
        );
    });

    it('requires the trademark notice beside every classified mark path', () => {
        const value = inventory();
        value.surfaces.push({
            ...value.surfaces[0]!,
            id: 'third-party-marks',
            paths: ['src/provider.ts'],
        });
        value.marks = [{ value: 'Roland', paths: ['src/provider.ts'] }];
        const state = snapshot();
        state.markPaths = { Roland: ['src/provider.ts'] };

        expect(validateReleaseInventory(value, state, ['Roland'])).toContain(
            `third-party-marks: required notice missing: ${TRADEMARK_NOTICE_PATH}`
        );
    });

    it('rejects component paths that fall through to a generic surface', () => {
        const value = inventory();
        value.surfaces.push({ ...value.surfaces[0]!, id: 'generic', paths: ['src/**'] });
        value.surfaces[0]!.paths = value.surfaces[0]!.paths.filter((path) => path !== 'src/**');

        expect(validateReleaseInventory(value, snapshot(), [], { runtime: ['src/provider.ts'] })).toContain(
            'runtime: required component paths missing:\n- src/provider.ts'
        );
    });

    it('rejects surface paths that match no tracked file', () => {
        const value = inventory();
        value.surfaces[0]!.paths.push('missing/**');

        expect(validateReleaseInventory(value, snapshot())).toContain('runtime: path is not tracked: missing/**');
    });

    it('discovers shipped assets and non-HTTP production endpoints', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(
            join(root, 'src/peer.ts'),
            "export const server = 'stun:stun.example.net:19302';\nexport const api = 'https:\\/\\/provider.example.net/v1';\nexport const dynamic = `https://api.example.net/files/${name.split('/')}`;\nexport const model = 'Hammond';\n// Never treat substrings as marks.\n"
        );
        writeFileSync(join(root, 'src/peer.spec.ts'), "export const fixture = 'https://fixture.example.net';\n");
        writeFileSync(join(root, 'sourdaw.png'), 'image');
        writeFileSync(join(root, 'notes.txt'), 'not shipped');

        try {
            const result = loadRepositorySnapshot(
                root,
                {
                    snapshots: [{ path: 'notes.txt', sha256: 'unused' }],
                    marks: [
                        { value: 'Hammond', paths: [] },
                        { value: 'Neve', paths: [] },
                    ],
                },
                ['notes.txt', 'sourdaw.png', 'src/peer.spec.ts', 'src/peer.ts']
            );
            expect(result.releaseFiles).toEqual(['notes.txt', 'sourdaw.png', 'src/peer.spec.ts', 'src/peer.ts']);
            expect(result.externalReferences).toEqual([
                {
                    file: 'src/peer.ts',
                    value: 'https://api.example.net/files/${slot}',
                    templateSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
                },
                { file: 'src/peer.ts', value: 'https://provider.example.net/v1' },
                { file: 'src/peer.ts', value: 'stun:stun.example.net:19302' },
            ]);
            expect(result.fileDigests['notes.txt']).toMatch(/^[0-9a-f]{64}$/);
            expect(result.markPaths).toEqual({ Hammond: ['src/peer.ts'], Neve: [] });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('does not treat verbatim dependency license text as product provenance or trademark claims', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(dirname(join(root, DEPENDENCY_LICENSE_REPORT_PATH)), { recursive: true });
        writeFileSync(
            join(root, DEPENDENCY_LICENSE_REPORT_PATH),
            'Exact third-party terms mention https://license.example and Roland.'
        );

        try {
            const result = loadRepositorySnapshot(root, { snapshots: [], marks: [{ value: 'Roland', paths: [] }] }, [
                DEPENDENCY_LICENSE_REPORT_PATH,
            ]);
            expect(result.releaseFiles).toEqual([DEPENDENCY_LICENSE_REPORT_PATH]);
            expect(result.externalReferences).toEqual([]);
            expect(result.markPaths).toEqual({ Roland: [] });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('ignores tracked files deleted from the working tree', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src/current.ts'), "export const value = 'current';\n");

        try {
            const result = loadRepositorySnapshot(root, { snapshots: [], marks: [] }, [
                'src/current.ts',
                'src/deleted.ts',
            ]);

            expect(result.releaseFiles).toEqual(['src/current.ts']);
            expect(result.externalReferences).toEqual([]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('scans production endpoints plus case-insensitive public marks', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(join(root, 'crates/plugin-host/src'), { recursive: true });
        mkdirSync(join(root, 'public'), { recursive: true });
        mkdirSync(join(root, 'server'), { recursive: true });
        writeFileSync(
            join(root, 'crates/plugin-host/src/descriptor.rs'),
            'static URL: &[u8] = b"https://app.example.net\\0";\n'
        );
        writeFileSync(join(root, 'index.html'), '<title>Roland tools</title>');
        writeFileSync(
            join(root, 'public/runtime.js'),
            "export const api = 'https://public.example.net/v1'; // ROLAND\n"
        );
        writeFileSync(
            join(root, 'server/index.js'),
            "export const api = 'wss://server.example.net/socket';\nnew WebSocket(api);\n"
        );

        try {
            const result = loadRepositorySnapshot(root, { snapshots: [], marks: [{ value: 'Roland', paths: [] }] }, [
                'crates/plugin-host/src/descriptor.rs',
                'index.html',
                'public/runtime.js',
                'server/index.js',
            ]);
            expect(result.externalReferences).toEqual([
                { file: 'crates/plugin-host/src/descriptor.rs', value: 'https://app.example.net' },
                { file: 'public/runtime.js', value: 'https://public.example.net/v1' },
                { file: 'server/index.js', value: 'runtime:WebSocket' },
                { file: 'server/index.js', value: 'wss://server.example.net/socket' },
            ]);
            expect(result.markPaths).toEqual({ Roland: ['index.html', 'public/runtime.js'] });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('detects template-expression drift', () => {
        const value = inventory();
        value.externalReferences[0]!.templateSha256 = fixtureDigest;
        const changed = snapshot();
        changed.externalReferences[0]!.templateSha256 = 'b'.repeat(64);

        expect(validateReleaseInventory(value, changed)).toEqual(
            expect.arrayContaining([
                expect.stringContaining('external references missing from inventory'),
                expect.stringContaining('stale external-reference assignments'),
            ])
        );
    });
});

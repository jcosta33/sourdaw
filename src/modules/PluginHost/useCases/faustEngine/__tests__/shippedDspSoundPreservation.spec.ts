// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

import { type IFaustCompiler } from '@grame/faustwasm/dist/esm/index.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { registerProSynthInstruments } from '#/modules/Synth/useCases';

import {
    assertOldFaustCaptureIdentity,
    compareSoundStreams,
    compileSoundDevice,
    encodeSoundStreams,
    OLD_FAUST_IDENTITY,
    publicSoundUi,
    renderSoundProfile,
    soundHash,
    type CompiledSoundDevice,
    type SoundRender,
    type SoundUi,
} from '../../../__tests__/faustSoundOracle';
import { faustSoundProfiles, type SoundProfile } from '../../../__tests__/faustSoundProfiles';
import { type FaustModule } from '../../../models/FaustEngineTypes';
import { loadFaustCompilerForSpec } from '../../../testing/loadFaustCompilerForSpec';
import { registerBuiltinFaustDSP } from '../builtinDSP';
import { faustEngineState } from '../faustEngineState';

vi.mock('@grame/faustwasm', async () => import('@grame/faustwasm/dist/esm/index.js'));

const PRODUCTION_BASE = '31bb18d130e09975b383c78fd2f909dd624ea282';
const FIXTURE_DIR = 'src/modules/PluginHost/__tests__/fixtures/faust-0.18.5';
const SOURCE_DIRS = ['src/modules/PluginHost/useCases/faustEngine/dsp', 'src/modules/Synth/useCases/dsp'];
const CAPTURE_TOKEN = 'freeze-faustwasm-0.18.5-libfaust-2.89.2';
const capture = process.env.SOURDAW_CAPTURE_FAUST_0185 === CAPTURE_TOKEN;

type RecordedCase = {
    profile: SoundProfile;
    moduleId: string;
    sourcePath: string;
    originalSourceSha256: string;
    route: 'effect-free-poly-8' | 'mono';
    ui: SoundUi[];
    appliedControls: SoundRender['appliedControls'];
    inputSha256: string;
    streams: {
        kind: 'audio' | 'meter';
        address: string;
        frames: number;
        stats: SoundRender['streams'][number]['stats'];
    }[];
    pcmSha256: string;
    gzipSha256: string;
    independentFreshRepeat: 'byte-identical';
};
type Manifest = {
    schema: 'sourdaw-faust-old-sound-v1';
    productionBase: string;
    captureCodeCommit: string;
    identity: typeof OLD_FAUST_IDENTITY;
    compilerVersion: string;
    captureInputs: Record<string, string>;
    libraryFiles: Record<string, string>;
    format: string;
    tolerance: { maxAbsolute: number; rms: number };
    cases: RecordedCase[];
};

const previousModules = new Map(faustEngineState.modules);
registerBuiltinFaustDSP();
registerProSynthInstruments();
const registered = [...faustEngineState.modules.values()];
const sources = SOURCE_DIRS.flatMap((directory) =>
    readdirSync(directory)
        .filter((file) => file.endsWith('.dsp'))
        .map((file) => {
            const path = join(directory, file);
            const code = readFileSync(path, 'utf8');
            const matching = registered.filter((module) => module.dspCode === code);
            if (matching.length !== 1 || !matching[0]) {
                throw new Error(`${path}: requires exactly one actual public registration`);
            }
            return { file, path, module: matching[0] };
        })
).sort((left, right) => left.file.localeCompare(right.file));
const profiles = faustSoundProfiles(sources.map(({ file, module }) => ({ file, instrument: module.isInstrument })));
const recorded: RecordedCase[] = [];
const compiled = new Map<string, Promise<CompiledSoundDevice>>();
let compiler: IFaustCompiler;
let manifest: Manifest;
let firstRender: SoundRender | undefined;

function sourceOf(profile: SoundProfile): (typeof sources)[number] {
    const source = sources.find((candidate) => candidate.file === profile.file);
    if (!source) {
        throw new Error(`Profile names an unregistered source: ${profile.file}`);
    }
    return source;
}

function deviceFor(module: FaustModule): Promise<CompiledSoundDevice> {
    let device = compiled.get(module.id);
    if (!device) {
        device = compileSoundDevice(compiler, module);
        compiled.set(module.id, device);
    }
    return device;
}

function metadata(
    profile: SoundProfile,
    device: CompiledSoundDevice,
    render: SoundRender,
    bytes: Buffer,
    zipped: Buffer
): RecordedCase {
    const source = sourceOf(profile);
    return {
        profile,
        moduleId: source.module.id,
        sourcePath: source.path,
        originalSourceSha256: soundHash(source.module.dspCode),
        route: source.module.isInstrument ? 'effect-free-poly-8' : 'mono',
        ui: device.ui,
        appliedControls: render.appliedControls,
        inputSha256: render.inputSha256,
        streams: render.streams.map(({ kind, address, samples, stats }) => ({
            kind,
            address,
            frames: samples.length,
            stats,
        })),
        pcmSha256: soundHash(bytes),
        gzipSha256: soundHash(zipped),
        independentFreshRepeat: 'byte-identical',
    };
}

/** These fixtures observe real public DSP computation, not WebAudio wiring, UI, physical output or every knob combination. */
describe('shipped Faust PCM against immutable pre-upgrade sound', () => {
    beforeAll(async () => {
        if (process.env.SOURDAW_CAPTURE_FAUST_0185 && !capture) {
            throw new Error('Invalid one-shot old Faust capture token');
        }
        compiler = await loadFaustCompilerForSpec();
        if (!capture) {
            manifest = JSON.parse(readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8')) as Manifest;
            return;
        }
        assertOldFaustCaptureIdentity(compiler);
        if (existsSync(FIXTURE_DIR)) {
            throw new Error(
                'Immutable old sound fixture directory already exists; never overwrite or update on failure'
            );
        }
        if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) {
            throw new Error('Commit capture code and cases before freezing old PCM from a clean head');
        }
        for (const source of sources) {
            const old = execFileSync('git', ['show', `${PRODUCTION_BASE}:${source.path}`]);
            if (soundHash(old) !== soundHash(source.module.dspCode)) {
                throw new Error(`Capture source differs from retained production base: ${source.path}`);
            }
        }
        const capturePaths = [
            'src/modules/PluginHost/__tests__/faustSoundProfiles.ts',
            'src/modules/PluginHost/__tests__/faustSoundOracle.ts',
            'src/modules/PluginHost/useCases/faustEngine/__tests__/shippedDspSoundPreservation.spec.ts',
            'src/modules/PluginHost/useCases/faustEngine/compileEffectFreeFaustPolyDsp.ts',
            'src/modules/PluginHost/testing/loadFaustCompilerForSpec.ts',
        ];
        manifest = {
            schema: 'sourdaw-faust-old-sound-v1',
            productionBase: PRODUCTION_BASE,
            captureCodeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            identity: OLD_FAUST_IDENTITY,
            compilerVersion: compiler.version(),
            captureInputs: Object.fromEntries(capturePaths.map((path) => [path, soundHash(readFileSync(path))])),
            libraryFiles: Object.fromEntries(
                ['envelopes.lib', 'filters.lib', 'oscillators.lib', 'reverbs.lib'].map((file) => [
                    file,
                    soundHash(compiler.fs().readFile(`/usr/share/faust/${file}`)),
                ])
            ),
            format: 'planar-f32le; audio streams then per-block meter streams; gzip lossless; no time/phase alignment',
            // Fixed absolute ceilings: -100 dBFS maximum sample error and -120 dBFS RMS error.
            tolerance: { maxAbsolute: 1e-5, rms: 1e-6 },
            cases: [],
        };
        mkdirSync(FIXTURE_DIR, { recursive: true });
    }, 240_000);

    afterAll(() => {
        if (capture && recorded.length === profiles.length) {
            manifest.cases = recorded;
            writeFileSync(join(FIXTURE_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
        }
        faustEngineState.modules.clear();
        for (const [id, module] of previousModules) {
            faustEngineState.modules.set(id, module);
        }
    });

    it('covers all 21 registered shipped source files and the exact frozen case census', () => {
        expect(sources).toHaveLength(21);
        expect(new Set(sources.map((source) => source.module.id)).size).toBe(21);
        expect(profiles.filter((profile) => profile.id.includes('-defaults-'))).toHaveLength(21);
        if (!capture) {
            expect(manifest.schema).toBe('sourdaw-faust-old-sound-v1');
            expect(manifest.productionBase).toBe(PRODUCTION_BASE);
            expect(manifest.identity).toEqual(OLD_FAUST_IDENTITY);
            expect(manifest.tolerance).toEqual({ maxAbsolute: 1e-5, rms: 1e-6 });
            expect(manifest.cases.map((entry) => entry.profile)).toEqual(profiles);
        }
    });

    it.each(profiles)(
        '$id preserves channels, frame positions and sound',
        async (profile) => {
            const source = sourceOf(profile);
            const device = await deviceFor(source.module);
            const actual = await renderSoundProfile(device, profile);
            firstRender ??= actual;
            const bytes = encodeSoundStreams(actual);
            if (capture) {
                // Reuses only the immutable compiled factory, never DSP memory or voice/envelope state.
                const repeated = await renderSoundProfile(device, profile);
                expect(encodeSoundStreams(repeated).equals(bytes), `${profile.id}: independent processors differ`).toBe(
                    true
                );
                const zipped = gzipSync(bytes, { level: 9 });
                writeFileSync(join(FIXTURE_DIR, `${profile.id}.f32.gz`), zipped, { flag: 'wx' });
                recorded.push(metadata(profile, device, actual, bytes, zipped));
                expect(bytes.byteLength).toBeGreaterThan(0);
                return;
            }
            const frozen = manifest.cases.find((entry) => entry.profile.id === profile.id);
            if (!frozen) {
                throw new Error(`${profile.id}: missing immutable expectation`);
            }
            const zipped = readFileSync(join(FIXTURE_DIR, `${profile.id}.f32.gz`));
            expect(soundHash(zipped)).toBe(frozen.gzipSha256);
            const baseline = gunzipSync(zipped);
            expect(soundHash(baseline)).toBe(frozen.pcmSha256);
            const difference = compareSoundStreams(baseline, actual, manifest.tolerance);
            expect(publicSoundUi(device.ui)).toEqual(publicSoundUi(frozen.ui));
            expect(actual.appliedControls).toEqual(frozen.appliedControls);
            expect(actual.inputSha256).toBe(frozen.inputSha256);
            expect(
                actual.streams.map(({ kind, address, samples }) => ({ kind, address, frames: samples.length }))
            ).toEqual(frozen.streams.map(({ kind, address, frames }) => ({ kind, address, frames })));
            expect(difference.maxAbsolute).toBeLessThanOrEqual(1e-5);
            expect(difference.rms).toBeLessThanOrEqual(1e-6);
        },
        240_000
    );

    it('ignores only compiler UI offsets and variable names while retaining the public control contract', () => {
        const ui = [
            {
                type: 'vgroup',
                label: 'EQ',
                items: [
                    {
                        type: 'hslider',
                        index: 8,
                        address: '/EQ/Q',
                        label: 'Q',
                        min: 0.1,
                        max: 10,
                        init: 1,
                        step: 0.1,
                        meta: [{ unit: 'ratio', index: 'public metadata is retained' }],
                    },
                ],
            },
        ];
        const relocated = structuredClone(ui);
        relocated[0]!.items[0]!.index = 24;
        expect(publicSoundUi(relocated)).toEqual(publicSoundUi(ui));
        const renamed = ui.map((group) => ({
            ...group,
            items: group.items.map((item) => ({ ...item, varname: 'fHslider99' })),
        }));
        expect(publicSoundUi(renamed)).toEqual(publicSoundUi(ui));
        for (const change of [{ max: 20 }, { address: '/EQ/another' }, { init: 2 }, { step: 0.2 }]) {
            const changed = structuredClone(ui);
            Object.assign(changed[0]!.items[0]!, change);
            expect(() => expect(publicSoundUi(changed)).toEqual(publicSoundUi(ui))).toThrow();
        }
        expect(ui[0]!.items[0]!.index).toBe(8);
        expect(publicSoundUi(ui)[0]!.items?.[0]).toMatchObject({ meta: [{ index: 'public metadata is retained' }] });
    });

    it('rejects an output-sample perturbation without changing the frozen fixture', () => {
        if (!firstRender || !profiles[0]) {
            throw new Error('The real first DSP render must exist before probing its comparison');
        }
        const actual = firstRender;
        const expected = capture
            ? encodeSoundStreams(actual)
            : gunzipSync(readFileSync(join(FIXTURE_DIR, `${profiles[0].id}.f32.gz`)));
        const perturbed = Buffer.from(expected);
        perturbed.writeFloatLE(perturbed.readFloatLE(4) + 0.01, 4);
        expect(() => compareSoundStreams(perturbed, actual)).toThrow('PCM drift');
        expect(compareSoundStreams(expected, actual).maxAbsolute).toBeLessThanOrEqual(1e-5);
        expect(() => compareSoundStreams(expected.subarray(0, 8), actual)).toThrow('PCM byte count differs');
        for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
            const nonfinite = Buffer.from(expected);
            nonfinite.writeFloatLE(value, 4);
            expect(() => compareSoundStreams(nonfinite, actual)).toThrow('Non-finite PCM at planar sample 1');
        }
    });
});

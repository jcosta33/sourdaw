import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
    FaustMonoDspGenerator,
    FaustMonoWebAudioDsp,
    FaustPolyWebAudioDsp,
    FaustWasmInstantiator,
    type IFaustCompiler,
} from '@grame/faustwasm/dist/esm/index.js';

import { type FaustModule } from '../models/FaustEngineTypes';
import { compileEffectFreeFaustPolyDsp } from '../useCases/faustEngine/compileEffectFreeFaustPolyDsp';

import { type SoundEvent, type SoundProfile } from './faustSoundProfiles';

export const OLD_FAUST_IDENTITY = {
    wrapperVersion: '0.18.5',
    compilerVersion: '2.89.2',
    libraryRevision: '36661b5efd702e0e21b3ad49864e10201aecc602',
    files: {
        'public/faust/libfaust-wasm.js': '73b9ee9ba0368f8a52d1e5feeeaee528930e38420acc9ea65b1198b480ed9e25',
        'public/faust/libfaust-wasm.data': '12e89b91e9b9fce899b1cdf6f62fdea18d95ce1ae63a69a61d76c3d365e52050',
        'public/faust/libfaust-wasm.wasm': 'b81cd9c08c5d230a193194286974a5403d0ca6c9fb2768987af8defca6527202',
        'node_modules/@grame/faustwasm/dist/esm/index.js':
            'f749fcbb8c62b40f510d355a83c8b654bd103e4b5767aa1e0f6f4edfe7b24985',
    },
} as const;

export type SoundUi = {
    type: string;
    address?: string;
    init?: number;
    min?: number;
    max?: number;
    step?: number;
    items?: SoundUi[];
};

type Processor = FaustMonoWebAudioDsp | FaustPolyWebAudioDsp;
export type CompiledSoundDevice = { ui: SoundUi[]; create(profile: SoundProfile): Promise<Processor> };
export type SoundStats = { peak: number; rms: number; firstNonzeroFrame: number | null; windowEnergy: number[] };
export type SoundRender = {
    streams: { kind: 'audio' | 'meter'; address: string; samples: Float32Array; stats: SoundStats }[];
    appliedControls: { name: string; address: string; value: number }[];
    inputSha256: string;
};

export function soundHash(bytes: Uint8Array | string): string {
    return createHash('sha256').update(bytes).digest('hex');
}

export function assertOldFaustCaptureIdentity(compiler: IFaustCompiler): void {
    const packageJson = JSON.parse(readFileSync('node_modules/@grame/faustwasm/package.json', 'utf8')) as {
        version: string;
    };
    if (
        packageJson.version !== OLD_FAUST_IDENTITY.wrapperVersion ||
        compiler.version() !== OLD_FAUST_IDENTITY.compilerVersion
    ) {
        throw new Error('Frozen sound expectations may only be captured with FaustWasm 0.18.5 / libfaust 2.89.2');
    }
    for (const [path, expected] of Object.entries(OLD_FAUST_IDENTITY.files)) {
        if (soundHash(readFileSync(path)) !== expected) {
            throw new Error(`Frozen old sound capture refuses different runtime bytes: ${path}`);
        }
    }
}

export async function compileSoundDevice(compiler: IFaustCompiler, module: FaustModule): Promise<CompiledSoundDevice> {
    const name = module.name.replaceAll(/\s+/g, '_');
    if (module.isInstrument) {
        if (module.polyEffectMode !== 'none') {
            throw new Error(`${name}: sound oracle requires the shipped effect-free poly route`);
        }
        const generator = await compileEffectFreeFaustPolyDsp(compiler, name, module.dspCode, '-I libraries/');
        const factory = generator?.voiceFactory;
        if (!generator || !factory) {
            throw new Error(`${name}: poly compilation failed`);
        }
        return {
            ui: (JSON.parse(factory.json) as { ui: SoundUi[] }).ui,
            async create(profile) {
                const instance = await FaustWasmInstantiator.createAsyncPolyDSPInstance(
                    factory,
                    generator.mixerModule,
                    8
                );
                return new FaustPolyWebAudioDsp(instance, profile.sampleRate, 4, profile.blockSize, factory.soundfiles);
            },
        };
    }
    const generator = await new FaustMonoDspGenerator().compile(compiler, name, module.dspCode, '-I libraries/');
    const factory = generator?.factory;
    if (!factory) {
        throw new Error(`${name}: mono compilation failed`);
    }
    return {
        ui: (JSON.parse(factory.json) as { ui: SoundUi[] }).ui,
        async create(profile) {
            const instance = await FaustWasmInstantiator.createAsyncMonoDSPInstance(factory);
            return new FaustMonoWebAudioDsp(instance, profile.sampleRate, 4, profile.blockSize, factory.soundfiles);
        },
    };
}

export function soundUiLeaves(items: SoundUi[]): SoundUi[] {
    return items.flatMap((item) => (item.items ? soundUiLeaves(item.items) : [item]));
}

function controlTable(ui: SoundUi[]): Map<string, { address: string; value: number }> {
    const controls = new Map<string, { address: string; value: number }>();
    for (const item of soundUiLeaves(ui)) {
        if (!item.address || item.type === 'hbargraph' || item.type === 'vbargraph') {
            continue;
        }
        const name = item.address.split('/').pop();
        const value = item.type === 'checkbox' || item.type === 'button' ? 0 : item.init;
        if (!name || value === undefined || controls.has(name)) {
            throw new Error(`Missing or ambiguous compiled control: ${item.address}`);
        }
        controls.set(name, { address: item.address, value });
    }
    return controls;
}

function inputSample(profile: SoundProfile, channel: number, frame: number): number {
    if (profile.input === 'stereo-impulses') {
        return channel === 0 ? Number(frame === 128) * 0.5 : -Number(frame === 389) * 0.25;
    }
    const time = frame / profile.sampleRate;
    if (profile.input === 'eq-probe') {
        return (channel === 0 ? 0.5 : 0.17) * Math.sin(2 * Math.PI * (channel === 0 ? 1500 : 1000) * time);
    }
    if (time >= 0.8) {
        return 0;
    }
    const programme =
        channel === 0
            ? 0.2 * Math.sin(2 * Math.PI * 997 * time) + 0.05 * Math.sin(2 * Math.PI * 83 * time)
            : 0.13 * Math.sin(2 * Math.PI * 2039 * time) - 0.03 * Math.sin(2 * Math.PI * 173 * time);
    if (profile.input === 'amplitude-steps') {
        return programme * (time < 0.15 ? 0.01 : time < 0.45 ? 3.2 : 0.16);
    }
    return programme;
}

function applyEvent(processor: Processor, controls: ReturnType<typeof controlTable>, event: SoundEvent): void {
    if (event.type === 'parameter') {
        const control = controls.get(event.name);
        if (!control) {
            throw new Error(`Timed control is absent: ${event.name}`);
        }
        processor.setParamValue(control.address, event.value);
        return;
    }
    if (!(processor instanceof FaustPolyWebAudioDsp)) {
        throw new Error('A MIDI event requires the real poly DSP');
    }
    if (event.type === 'on') {
        processor.keyOn(event.channel, event.pitch, event.velocity);
    } else {
        processor.keyOff(event.channel, event.pitch, event.velocity);
    }
}

export function soundStats(samples: Float32Array, windowFrames: number): SoundStats {
    let peak = 0;
    let sum = 0;
    let firstNonzeroFrame: number | null = null;
    const windowEnergy: number[] = [];
    for (let frame = 0; frame < samples.length; frame++) {
        const sample = samples[frame];
        if (sample === undefined || !Number.isFinite(sample)) {
            throw new Error(`Non-finite or missing output at frame ${frame}`);
        }
        peak = Math.max(peak, Math.abs(sample));
        sum += sample * sample;
        if (firstNonzeroFrame === null && Math.abs(sample) > 1e-9) {
            firstNonzeroFrame = frame;
        }
        const window = Math.floor(frame / windowFrames);
        windowEnergy[window] = (windowEnergy[window] ?? 0) + sample * sample;
    }
    return { peak, rms: Math.sqrt(sum / samples.length), firstNonzeroFrame, windowEnergy };
}

export async function renderSoundProfile(device: CompiledSoundDevice, profile: SoundProfile): Promise<SoundRender> {
    if (
        profile.frames % profile.blockSize !== 0 ||
        profile.events.some(
            (event, index) =>
                !Number.isInteger(event.frame) ||
                event.frame < 0 ||
                event.frame >= profile.frames ||
                (index > 0 && event.frame < profile.events[index - 1]!.frame)
        )
    ) {
        throw new Error(`${profile.id}: invalid frame schedule`);
    }
    const processor = await device.create(profile);
    try {
        const controls = controlTable(device.ui);
        for (const [name, value] of Object.entries(profile.controls)) {
            const control = controls.get(name);
            if (!control) {
                throw new Error(`${profile.id}: unknown control ${name}`);
            }
            control.value = value;
        }
        const paths = new Set(processor.getParams());
        const appliedControls = [...controls].map(([name, control]) => ({ name, ...control }));
        for (const { address, value } of appliedControls) {
            if (!paths.has(address)) {
                throw new Error(`${profile.id}: processor is missing compiled control ${address}`);
            }
            processor.setParamValue(address, value);
            if (Math.abs(processor.getParamValue(address) - value) > Math.max(1e-6, Math.abs(value) * 1e-6)) {
                throw new Error(`${profile.id}: control did not reach the processor: ${address}`);
            }
        }
        const inputs = Array.from({ length: processor.getNumInputs() }, () => new Float32Array(profile.blockSize));
        const outputs = Array.from({ length: processor.getNumOutputs() }, () => new Float32Array(profile.blockSize));
        if (outputs.length !== 2) {
            throw new Error(`${profile.id}: expected the two shipped output channels, got ${outputs.length}`);
        }
        const pcm = outputs.map(() => new Float32Array(profile.frames));
        const meters = soundUiLeaves(device.ui).filter(
            (item) => item.type === 'vbargraph' || item.type === 'hbargraph'
        );
        const meterPcm = meters.map(() => new Float32Array(profile.frames / profile.blockSize));
        const inputHash = createHash('sha256');
        processor.start();
        for (let offset = 0; offset < profile.frames; offset += profile.blockSize) {
            for (const [channel, input] of inputs.entries()) {
                for (let frame = 0; frame < profile.blockSize; frame++) {
                    input[frame] = inputSample(profile, channel, offset + frame);
                }
                inputHash.update(new Uint8Array(input.buffer));
            }
            for (const output of outputs) {
                output.fill(Number.NaN);
            }
            const events = profile.events
                .filter((event) => event.frame >= offset && event.frame < offset + profile.blockSize)
                .map((event) => ({ frame: event.frame - offset, apply: () => applyEvent(processor, controls, event) }));
            if (!processor.compute(inputs, outputs, events)) {
                throw new Error(`${profile.id}: DSP refused block at ${offset}`);
            }
            for (const [channel, output] of outputs.entries()) {
                pcm[channel]!.set(output, offset);
            }
            for (const [index, item] of meters.entries()) {
                if (!item.address) {
                    throw new Error('Meter is missing its address');
                }
                meterPcm[index]![offset / profile.blockSize] = processor.getParamValue(item.address);
            }
        }
        const streams: SoundRender['streams'] = pcm.map((samples, channel) => ({
            kind: 'audio',
            address: `output/${channel}`,
            samples,
            stats: soundStats(samples, Math.round(profile.sampleRate / 10)),
        }));
        for (const [index, samples] of meterPcm.entries()) {
            streams.push({ kind: 'meter', address: meters[index]!.address!, samples, stats: soundStats(samples, 32) });
        }
        if (streams.filter((stream) => stream.kind === 'audio').every((stream) => stream.stats.peak < 1e-8)) {
            throw new Error(`${profile.id}: silent audio is not an admitted baseline`);
        }
        return { streams, appliedControls, inputSha256: inputHash.digest('hex') };
    } finally {
        processor.destroy();
    }
}

/** Planar float32 little-endian, audio first then meter streams; lengths are retained separately. */
export function encodeSoundStreams(render: SoundRender): Buffer {
    const bytes = Buffer.alloc(render.streams.reduce((sum, stream) => sum + stream.samples.length * 4, 0));
    let offset = 0;
    for (const stream of render.streams) {
        for (const sample of stream.samples) {
            bytes.writeFloatLE(sample, offset);
            offset += 4;
        }
    }
    return bytes;
}

export function compareSoundStreams(
    expected: Uint8Array,
    render: SoundRender,
    tolerance = { maxAbsolute: 1e-5, rms: 1e-6 }
): { maxAbsolute: number; rms: number; firstChangedSample: number | null } {
    const actual = encodeSoundStreams(render);
    if (expected.byteLength !== actual.byteLength) {
        throw new Error(`PCM byte count differs: expected ${expected.byteLength}, actual ${actual.byteLength}`);
    }
    const view = new DataView(expected.buffer, expected.byteOffset, expected.byteLength);
    let maxAbsolute = 0;
    let sum = 0;
    let firstChangedSample: number | null = null;
    for (let offset = 0; offset < actual.byteLength; offset += 4) {
        const baseline = view.getFloat32(offset, true);
        const sample = actual.readFloatLE(offset);
        if (!Number.isFinite(baseline) || !Number.isFinite(sample)) {
            throw new Error(`Non-finite PCM at planar sample ${offset / 4}`);
        }
        const error = Math.abs(sample - baseline);
        if (error !== 0 && firstChangedSample === null) {
            firstChangedSample = offset / 4;
        }
        maxAbsolute = Math.max(maxAbsolute, error);
        sum += error * error;
    }
    const rms = Math.sqrt(sum / (actual.byteLength / 4));
    if (maxAbsolute > tolerance.maxAbsolute || rms > tolerance.rms) {
        throw new Error(
            `PCM drift: maxAbs=${maxAbsolute}, rms=${rms}, firstChangedPlanarSample=${firstChangedSample}; ` +
                `limits=${JSON.stringify(tolerance)}`
        );
    }
    return { maxAbsolute, rms, firstChangedSample };
}

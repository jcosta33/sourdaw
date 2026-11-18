import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import {
    acceptsExternalPluginAutomationParameter,
    addClip,
    clampDeviceParameterValue,
    clampExternalPluginAutomationValue,
    createTrack,
    isDeviceParameterAutomatable,
    quantiseDeviceParameterValue,
} from '#/modules/Arrangement/useCases';
import { type AutomationLane, automationStore } from '#/modules/Automation/stores';
import {
    createAutomationLane,
    createOfflineAutomationEvaluator,
    getAutomationValueAtBeat,
} from '#/modules/Automation/useCases';
import {
    cacheAudioBuffer,
    configureOfflineDeviceParameterLaw,
    configureOfflineMidiEventProjection,
    configureOfflinePpqEndpointProjection,
    refreshEngineRtDiagnostics,
} from '#/modules/AudioEngine/useCases';
import {
    createChordPitchProjector,
    createGrooveMidiEventProjector,
    shouldPlayMidiEvent,
} from '#/modules/MIDI/useCases';
import { externalPluginParameterStore, externalPluginTailStore, pluginScanStore } from '#/modules/PluginHost/stores';
import { activateExternalPlugin, addPluginFolder, startPluginScan } from '#/modules/PluginHost/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { beatAtSecondsFromAnchor, projectPpqEndpoints, resolveTempoAtBeat } from '#/modules/Transport/useCases';

import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { ExportDialog } from '../ExportDialog';

const FIXTURE_DIRECTORY = process.env.SOURDAW_HOSTED_EFFECT_EXPORT_FIXTURES;
const ARTIFACT_DIRECTORY = process.env.SOURDAW_HOSTED_EFFECT_EXPORT_ARTIFACTS;
const PLUGIN_DESCRIPTOR = 'com.sourdaw.harness-fx';
const DEVICE_ID = 'harness-echo';
const INSTANCE_ID = 'harness-echo-instance';
const SOURCE_ID = 'harness-echo-stereo-pulses';
const OUTPUT_NAMES = ['automated-auto-tail.wav', 'static-auto-tail.wav', 'automated-zero-tail.wav'] as const;
type OutputName = (typeof OUTPUT_NAMES)[number];

const CLIP_END_BEAT = 1;
const GAIN_CHANGE_BEAT = 0.5;
const EARLY_GAIN = 0.25;
const LATE_GAIN = 0.75;
const DEFAULT_GAIN = 0.5;
// The current device automation slew can stop within 5e-5 of its target.
const MAX_GAIN_ERROR = 5e-5;
const LATENCY_FRAMES = 64;
const ECHO_FRAMES = 480;
const EARLY_PULSE_FRAME = 2_048;
const FRAMES_FROM_LATE_PULSE_TO_CLIP_END = 320;
const INPUT_LEFT = 0.5;
const INPUT_RIGHT = -0.25;

// jsdom provides no PCM container. All processing in this test is native.
class TestAudioBuffer {
    readonly length: number;
    readonly sampleRate: number;
    readonly numberOfChannels: number;
    readonly duration: number;
    private readonly channels: Float32Array<ArrayBuffer>[];

    constructor({ length, sampleRate, numberOfChannels }: AudioBufferOptions) {
        this.length = length;
        this.sampleRate = sampleRate;
        this.numberOfChannels = numberOfChannels ?? 1;
        this.duration = length / sampleRate;
        this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(length));
    }

    getChannelData(channel: number): Float32Array<ArrayBuffer> {
        return this.channels[channel]!;
    }

    copyToChannel(source: Float32Array<ArrayBuffer>, channel: number): void {
        this.getChannelData(channel).set(source);
    }
}

type NativeHost = {
    runtimeScopeInfoV1: () => { root: string; projects: string; exportStateAvailable: boolean };
    registerPluginWindowHost: (callbacks: Record<string, () => void>) => void;
    grantPluginFolder: (folder: string) => Promise<string>;
    applyGraphCommands: (batch: { schemaVersion: number; commands: [] }) => Promise<unknown>;
    shutdown: () => unknown;
};

type NativeAddon = {
    SourdawNative: {
        withRuntimeScopeV1: (emit: (event: string, payload: unknown) => void, root: string) => NativeHost;
    };
};

function makeNativeHarness(fixtureDirectory: string, workDirectory: string) {
    const root = join(workDirectory, '.sourdaw-native-runtime-scopes-v1', randomUUID());
    const pluginDirectory = join(workDirectory, 'plugins');
    mkdirSync(root, { recursive: true });
    mkdirSync(pluginDirectory);
    copyFileSync(join(fixtureDirectory, 'libsourdaw_harness_fx.dylib'), join(pluginDirectory, 'HarnessFx.clap'));
    vi.stubEnv(
        'SOURDAW_PLUGIN_SCAN_WORKER_COMMAND',
        JSON.stringify({ program: join(fixtureDirectory, 'sourdaw-plugin-scan-helper') })
    );

    const { SourdawNative } = createRequire(import.meta.url)(
        join(fixtureDirectory, 'sourdaw-native.node')
    ) as NativeAddon;
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const host = SourdawNative.withRuntimeScopeV1((event, payload) => {
        for (const listener of listeners.get(event) ?? []) {
            listener(payload);
        }
    }, root);
    const scope = host.runtimeScopeInfoV1();
    expect(scope).toMatchObject({ root, exportStateAvailable: true });
    const unexpectedEditor = () => {
        throw new Error('The harness effect has no editor');
    };
    host.registerPluginWindowHost({
        createEditorWindow: unexpectedEditor,
        editorWindowExists: () => false,
        setEditorWindowSize: unexpectedEditor,
        setEditorWindowResizable: unexpectedEditor,
        showAndFocusEditorWindow: unexpectedEditor,
        destroyEditorWindow: unexpectedEditor,
        hideEditorWindow: unexpectedEditor,
        showEditorWindow: unexpectedEditor,
    });

    let outputName: OutputName = OUTPUT_NAMES[0];
    const invoke = async (command: string, args: readonly unknown[] = []): Promise<unknown> => {
        // Restrict discovery to the fixture's granted folder.
        if (command === 'get_default_plugin_paths') {
            return [];
        }
        const method: unknown = Reflect.get(
            host,
            command.replaceAll(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase())
        );
        if (typeof method !== 'function') {
            throw new Error(`Unhandled native command ${command}`);
        }
        const nativeArgs = command === 'scan_plugins' ? [args[0], args[1] ?? false] : args;
        return Reflect.apply(method, host, nativeArgs);
    };

    const bridge = {
        invoke,
        async invokeBinary(command, meta, bytes) {
            return invoke(command, [...meta, Buffer.from(bytes)]);
        },
        async invokeBinaryResponse(command, args) {
            const result = await invoke(command, args);
            if (!Buffer.isBuffer(result)) {
                throw new TypeError(`${command} must return native bytes`);
            }
            return Uint8Array.from(result);
        },
        listen(event, callback) {
            let subscribers = listeners.get(event);
            if (subscribers === undefined) {
                subscribers = new Set();
                listeners.set(event, subscribers);
            }
            subscribers.add(callback);
            return () => subscribers.delete(callback);
        },
        dialog: {
            save: () => Promise.resolve(join(scope.projects, outputName)),
        },
        pluginFolders: {
            add: async () => ({ status: 'granted', path: await host.grantPluginFolder(pluginDirectory) }),
        },
    } satisfies Pick<
        SourdawDesktopBridge,
        'invoke' | 'invokeBinary' | 'invokeBinaryResponse' | 'listen' | 'pluginFolders'
    > & {
        dialog: Pick<SourdawDesktopBridge['dialog'], 'save'>;
    };

    return {
        host,
        bridge,
        selectOutput(name: OutputName) {
            outputName = name;
            return join(scope.projects, name);
        },
    };
}

function configureRenderPorts(): void {
    setNotificationEventBus(createEventBus());
    configureOfflineMidiEventProjection({
        createProjector: createGrooveMidiEventProjector,
        selectProbability: shouldPlayMidiEvent,
        createChordPitchProjector,
        evaluateAutomationValue: getAutomationValueAtBeat,
        createAutomationValueEvaluator: createOfflineAutomationEvaluator,
    });
    configureOfflinePpqEndpointProjection({
        project: projectPpqEndpoints,
        resolveTempoAtBeat,
        beatAtSecondsFromAnchor,
    });
    configureOfflineDeviceParameterLaw({
        captureExternalPluginLaw: (source = externalPluginParameterStore.value) => {
            const state = structuredClone(source);
            return {
                acceptsExternalPluginParameter: (instanceId, parameterId) =>
                    acceptsExternalPluginAutomationParameter(instanceId, parameterId, state),
                clampExternalPluginValue: (input) => clampExternalPluginAutomationValue(input, state),
            };
        },
        isAutomatable: isDeviceParameterAutomatable,
        clampValue: clampDeviceParameterValue,
        quantiseValue: quantiseDeviceParameterValue,
        acceptsExternalPluginParameter: acceptsExternalPluginAutomationParameter,
        clampExternalPluginValue: clampExternalPluginAutomationValue,
    });
}

function arrangeProject(
    sampleRate: number,
    plugin: { id: string; name: string }
): {
    lane: AutomationLane;
    clipEndFrame: number;
    latePulseFrame: number;
} {
    // One beat at 120 BPM, with the loop export range ending exactly on the clip.
    const clipEndFrame = sampleRate / 2;
    const latePulseFrame = clipEndFrame - FRAMES_FROM_LATE_PULSE_TO_CLIP_END;
    const material = new AudioBuffer({ length: clipEndFrame, numberOfChannels: 2, sampleRate });
    for (const frame of [EARLY_PULSE_FRAME, latePulseFrame]) {
        material.getChannelData(0)[frame] = INPUT_LEFT;
        material.getChannelData(1)[frame] = INPUT_RIGHT;
    }
    cacheAudioBuffer({ buffer: material, bufferId: SOURCE_ID });
    const track = createTrack({ name: 'Stereo pulses', kind: 'audio' });
    trackStore.set({
        ...defaultTrackState,
        tracks: [
            {
                ...track,
                gain: 1,
                devices: [
                    {
                        id: DEVICE_ID,
                        name: plugin.name,
                        type: 'external-plugin',
                        bypassed: false,
                        externalPluginId: plugin.id,
                        externalInstanceId: INSTANCE_ID,
                        parameterValues: {},
                    },
                ],
            },
        ],
    });
    expect(
        addClip({
            name: 'Two equal stereo pulses',
            trackId: track.id,
            type: 'audio',
            audioBufferId: SOURCE_ID,
            startBeat: 0,
            endBeat: CLIP_END_BEAT,
        })
    ).not.toBeNull();
    transportStore.set({
        ...defaultTransportState,
        tempo: 120,
        masterGain: 100,
        loopStart: 0,
        loopEnd: CLIP_END_BEAT,
    });
    return {
        lane: {
            ...createAutomationLane(track.id, `${DEVICE_ID}:0`, 'Gain'),
            points: [
                { beat: 0, value: EARLY_GAIN, curve: 'step', tension: 0 },
                { beat: GAIN_CHANGE_BEAT, value: LATE_GAIN, curve: 'step', tension: 0 },
            ],
        },
        clipEndFrame,
        latePulseFrame,
    };
}

async function exportWav(sampleRate: number, autoTail: boolean) {
    const dialog = render(<ExportDialog open onClose={() => {}} />);
    try {
        fireEvent.click(screen.getByRole('radio', { name: /^Loop region/ }));
        fireEvent.click(screen.getByRole('button', { name: `${(sampleRate / 1_000).toFixed(1)}k`, exact: true }));
        fireEvent.click(screen.getByRole('button', { name: '32-bit', exact: true }));
        const auto = screen.getByLabelText('Auto-detect');
        expect(auto).toBeChecked();
        if (autoTail) {
            expect(screen.getByText('2.00s minimum (0.01s detected)')).toBeVisible();
        } else {
            fireEvent.click(auto);
            fireEvent.change(screen.getByLabelText('Tail seconds'), { target: { value: '0' } });
        }
        fireEvent.click(screen.getByTestId('export-start'));
        const status = await screen.findByText(/^Export (complete|failed)\.$/u, {}, { timeout: 15_000 });
        expect(status.parentElement?.textContent).toContain('Export complete.');
    } finally {
        dialog.unmount();
    }
}

function readStereoFloatWav(path: string, sampleRate: number) {
    const bytes = readFileSync(path);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(bytes.readUInt16LE(20)).toBe(3);
    expect(bytes.readUInt16LE(22)).toBe(2);
    expect(bytes.readUInt32LE(24)).toBe(sampleRate);
    expect(bytes.readUInt16LE(34)).toBe(32);
    const data = 28 + bytes.readUInt32LE(16);
    expect(bytes.toString('ascii', data - 8, data - 4)).toBe('data');
    const dataBytes = bytes.readUInt32LE(data - 4);
    expect(bytes.length).toBe(data + dataBytes);
    const frames = dataBytes / 8;
    expect(Number.isInteger(frames)).toBe(true);
    return {
        frames,
        sample: (frame: number, channel: 0 | 1) => bytes.readFloatLE(data + frame * 8 + channel * 4),
    };
}

function expectTaps(
    wav: ReturnType<typeof readStereoFloatWav>,
    taps: readonly { frame: number; gain: number }[]
): void {
    const expected = new Map(taps.map(({ frame, gain }) => [frame, gain]));
    let quietPeak = 0;
    for (let frame = 0; frame < wav.frames; frame++) {
        const left = wav.sample(frame, 0);
        const right = wav.sample(frame, 1);
        const gain = expected.get(frame);
        if (gain === undefined) {
            quietPeak = Math.max(quietPeak, Math.abs(left), Math.abs(right));
            continue;
        }
        expect(Math.abs(left - INPUT_LEFT * gain), `left tap at frame ${frame}`).toBeLessThan(
            MAX_GAIN_ERROR * Math.abs(INPUT_LEFT)
        );
        expect(Math.abs(right - INPUT_RIGHT * gain), `right tap at frame ${frame}`).toBeLessThan(
            MAX_GAIN_ERROR * Math.abs(INPUT_RIGHT)
        );
    }
    expect(quietPeak, 'peak outside the expected effect taps').toBeLessThan(0.000001);
}

// A native-audio opt-in. A provided fixture directory is a requirement, and
// any missing or broken binary, scan or output stream fails the case.
it.runIf(FIXTURE_DIRECTORY !== undefined)(
    'exports a hosted CLAP gain ride and a post-clip echo in the committed mixdown WAV',
    async () => {
        if (!FIXTURE_DIRECTORY) {
            throw new Error('Set SOURDAW_HOSTED_EFFECT_EXPORT_FIXTURES to the native fixture build directory');
        }
        const workDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-hosted-effect-export-')));
        let host: NativeHost | undefined;
        try {
            localStorage.removeItem('sourdaw:export-settings');
            vi.stubGlobal('AudioBuffer', TestAudioBuffer);
            vi.stubGlobal(
                'OfflineAudioContext',
                class {
                    constructor() {
                        throw new Error('Hosted-effect export must use the native renderer');
                    }
                }
            );
            const harness = makeNativeHarness(resolve(FIXTURE_DIRECTORY), workDirectory);
            host = harness.host;
            vi.stubGlobal('sourdaw', harness.bridge);
            expect(await addPluginFolder()).toMatchObject({ added: true });
            await startPluginScan();
            expect(pluginScanStore.value?.errors).toEqual([]);
            const plugin = pluginScanStore.value?.scannedPlugins.find(
                ({ descriptor_id }) => descriptor_id === PLUGIN_DESCRIPTOR
            );
            if (!plugin) {
                throw new Error('The native scan did not find the fixture CLAP effect');
            }
            expect(plugin).toMatchObject({ category: 'effect', format: 'clap' });
            expect(await host.applyGraphCommands({ schemaVersion: 1, commands: [] })).toMatchObject({
                acceptance: 'accepted',
                application: 'applied',
            });
            const diagnostics = await refreshEngineRtDiagnostics();
            const sampleRate = diagnostics?.sampleRate;
            if (sampleRate !== 44_100 && sampleRate !== 48_000) {
                throw new Error(
                    `Use a 44.1 or 48 kHz default audio output for this fixture. Engine rate: ${String(sampleRate)}`
                );
            }
            expect(await activateExternalPlugin({ pluginId: plugin.id, instanceId: INSTANCE_ID })).toEqual({
                status: 'active',
            });
            expect(externalPluginParameterStore.value?.byInstanceId[INSTANCE_ID]?.engineAttached).toBe(true);
            expect(externalPluginTailStore.value?.tailSamplesByInstanceId[INSTANCE_ID]).toBe(ECHO_FRAMES);
            configureRenderPorts();
            const { lane, clipEndFrame, latePulseFrame } = arrangeProject(sampleRate, plugin);
            const earlyDirect = EARLY_PULSE_FRAME + LATENCY_FRAMES;
            const earlyEcho = earlyDirect + ECHO_FRAMES;
            const lateDirect = latePulseFrame + LATENCY_FRAMES;
            const lateEcho = lateDirect + ECHO_FRAMES;
            expect(lateDirect).toBeLessThan(clipEndFrame);
            expect(lateEcho).toBeGreaterThan(clipEndFrame);

            for (const name of OUTPUT_NAMES) {
                const automated = name !== 'static-auto-tail.wav';
                const autoTail = name !== 'automated-zero-tail.wav';
                automationStore.set({ lanes: automated ? [lane] : [] });
                const outputPath = harness.selectOutput(name);
                await exportWav(sampleRate, autoTail);
                const wav = readStereoFloatWav(outputPath, sampleRate);
                const earlyGain = automated ? EARLY_GAIN : DEFAULT_GAIN;
                const lateGain = automated ? LATE_GAIN : DEFAULT_GAIN;
                const taps = [
                    { frame: earlyDirect, gain: earlyGain },
                    { frame: earlyEcho, gain: earlyGain * 0.5 },
                    { frame: lateDirect, gain: lateGain },
                ];
                if (autoTail) {
                    taps.push({ frame: lateEcho, gain: lateGain * 0.5 });
                }
                expect(wav.frames).toBe(clipEndFrame + (autoTail ? sampleRate * 2 : 0));
                expectTaps(wav, taps);
                if (ARTIFACT_DIRECTORY) {
                    copyFileSync(outputPath, join(ARTIFACT_DIRECTORY, name));
                    console.info(name, {
                        sampleRate,
                        frames: wav.frames,
                        clipEndFrame,
                        taps: taps.map(({ frame }) => [frame, wav.sample(frame, 0), wav.sample(frame, 1)]),
                    });
                }
            }
        } finally {
            host?.shutdown();
            localStorage.removeItem('sourdaw:export-settings');
            vi.unstubAllGlobals();
            vi.unstubAllEnvs();
            rmSync(workDirectory, { recursive: true, force: true });
        }
    },
    60_000
);

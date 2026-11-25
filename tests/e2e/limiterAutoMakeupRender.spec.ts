import { expect, test } from './e2eTest';

import type { AutomationLane } from '../../src/modules/Automation/models/Automation';

/**
 * The built-in limiter's Auto Makeup switch, rendered in real Chromium.
 *
 * The limiter's first stage is Chromium's `DynamicsCompressorNode` at ratio
 * 20 and no knee, which adds a hidden post-gain of about
 * 0.6 × |threshold| × (1 − 1/20) dB. Off: a sine below threshold leaves at its
 * input level times the declared ceiling gain, at every threshold. On, and a
 * stored limiter that predates the switch, render the graph the limiter had
 * before the switch existed, sample for sample.
 */

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 1;
/** Frames before this are start-up: the envelope settles well inside it. */
const SETTLED_FROM_SECONDS = 0.5;
/**
 * The canceller divides by a measured gain through a 32 769-point reciprocal
 * curve (relative error under 4e-6, about 3e-5 dB), so 0.01 dB leaves two
 * orders of magnitude of margin while staying far under the smallest hidden
 * gain on the threshold range (+0.57 dB at −1 dB).
 */
const UNITY_TOLERANCE_DB = 0.01;
const LAW_TOLERANCE_DB = 0.02;
const RESIDUAL_BUDGET_DBFS = -120;

/** The descriptor's whole threshold range, its default, and the issue's −24 dB. */
const THRESHOLDS_DB: readonly number[] = [-30, -24, -6, -1];
/** The issue's measurement level: below every threshold, above Blink's detector floor. */
const QUIET_SINE_PEAK_DBFS = -50;
const LOUD_LEVEL_DBFS = -3;

type RenderRequest = {
    thresholdDb: number;
    ceilingDb: number;
    /** Absent leaves the stored record without the key, as a project from before the switch. */
    autoMakeup?: number;
    signal: { kind: 'sine' | 'steady'; levelDbfs: number };
    /** The stored record goes through the project's read migration first. */
    readAsStored?: boolean;
};

type RenderResult = {
    deviceLevelDb: number;
    previousGraphLevelDb: number;
    residualDbfs: number;
    hiddenMakeupDb: number;
    staticOutputDb: number;
};

async function render(page: import('@playwright/test').Page, request: RenderRequest): Promise<RenderResult> {
    return page.evaluate(
        async ({ request, sampleRate, durationSeconds, settledFromSeconds }) => {
            const [{ createWebAudioDevice }, law, { migrateStoredDeviceParameterValues }, { makeCeilingClipCurve }] =
                await Promise.all([
                    import('/src/modules/AudioEngine/repositories/deviceStrategy/WebAudioDeviceStrategy.ts'),
                    import('/src/utils/dynamicsCompressorMakeupLaw.ts'),
                    import('/src/modules/Arrangement/models/StoredDeviceParameterMigration.ts'),
                    import('/src/modules/AudioEngine/repositories/devices/dynamics/makeCeilingClipCurve.ts'),
                ]);
            const frameCount = sampleRate * durationSeconds;
            const context = new OfflineAudioContext(2, frameCount, sampleRate);
            const merger = context.createChannelMerger(2);
            merger.connect(context.destination);

            const stored: Record<string, number> = {
                'lim-threshold': request.thresholdDb,
                'lim-release': 100,
                'lim-ceiling': request.ceilingDb,
            };
            if (request.autoMakeup !== undefined) {
                stored['lim-auto-makeup'] = request.autoMakeup;
            }
            let parameterValues = stored;
            if (request.readAsStored) {
                parameterValues = migrateStoredDeviceParameterValues('builtin-limiter', stored);
            }
            const device = createWebAudioDevice(context, {
                id: 'device-1',
                name: 'Limiter',
                type: 'builtin-limiter',
                bypassed: false,
                parameterValues,
            });

            // The limiter's graph before the switch existed: the node, the
            // ceiling gain, then the ceiling clip, with the same settings.
            const ceilingGain = 10 ** (request.ceilingDb / 20);
            const previous = context.createDynamicsCompressor();
            previous.threshold.value = request.thresholdDb;
            previous.ratio.value = 20;
            previous.attack.value = 0.001;
            previous.release.value = 0.1;
            previous.knee.value = 0;
            const previousCeiling = context.createGain();
            previousCeiling.gain.value = ceilingGain;
            const previousClipper = context.createWaveShaper();
            previousClipper.curve = makeCeilingClipCurve(ceilingGain);
            previousClipper.oversample = 'none';
            previous.connect(previousCeiling);
            previousCeiling.connect(previousClipper);

            const amplitude = 10 ** (request.signal.levelDbfs / 20);
            const buffer = context.createBuffer(1, frameCount, sampleRate);
            const samples = buffer.getChannelData(0);
            samples.fill(amplitude);
            if (request.signal.kind === 'sine') {
                for (let frame = 0; frame < frameCount; frame++) {
                    samples[frame] = amplitude * Math.sin((2 * Math.PI * 997 * frame) / sampleRate);
                }
            }
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(device.node.inputNode);
            source.connect(previous);
            device.node.outputNode.connect(merger, 0, 0);
            previousClipper.connect(merger, 0, 1);
            source.start(0);
            const rendered = await context.startRendering();
            const deviceSamples = rendered.getChannelData(0);
            const previousSamples = rendered.getChannelData(1);

            const settledFrom = Math.round(settledFromSeconds * sampleRate);
            const levelDb = (channel: Float32Array, reference: number): number => {
                let sum = 0;
                for (let frame = settledFrom; frame < channel.length; frame++) {
                    sum += channel[frame] * channel[frame];
                }
                return 10 * Math.log10(sum / (channel.length - settledFrom)) - reference;
            };
            // A sine's mean square is half its peak's; the steady level's is its own.
            const meanSquareReferenceDb =
                request.signal.kind === 'sine' ? 20 * Math.log10(amplitude) - 10 * Math.log10(2) : 0;
            let residual = 0;
            for (let frame = 0; frame < rendered.length; frame++) {
                residual = Math.max(residual, Math.abs(deviceSamples[frame] - previousSamples[frame]));
            }
            const curve = { thresholdDb: request.thresholdDb, kneeDb: 0, ratio: 20 };
            return {
                deviceLevelDb: levelDb(deviceSamples, meanSquareReferenceDb),
                previousGraphLevelDb: levelDb(previousSamples, meanSquareReferenceDb),
                residualDbfs: residual === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(residual),
                hiddenMakeupDb: law.dynamicsCompressorHiddenMakeupDb(curve),
                staticOutputDb: law.dynamicsCompressorStaticOutputDb(curve, request.signal.levelDbfs),
            };
        },
        {
            request,
            sampleRate: SAMPLE_RATE,
            durationSeconds: DURATION_SECONDS,
            settledFromSeconds: SETTLED_FROM_SECONDS,
        }
    );
}

async function attach(testInfo: import('@playwright/test').TestInfo, name: string, body: unknown): Promise<void> {
    await testInfo.attach(name, { body: JSON.stringify(body, null, 2), contentType: 'application/json' });
}

test.describe('built-in limiter Auto Makeup', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    for (const thresholdDb of THRESHOLDS_DB) {
        test(`off passes a quiet sine at unity at threshold ${thresholdDb} dB`, async ({ page }, testInfo) => {
            const result = await render(page, {
                thresholdDb,
                ceilingDb: 0,
                autoMakeup: 0,
                signal: { kind: 'sine', levelDbfs: QUIET_SINE_PEAK_DBFS },
            });
            await attach(testInfo, 'render-metrics', result);
            // The previous graph adds the hidden makeup; off removes exactly that.
            expect(Math.abs(result.previousGraphLevelDb - result.hiddenMakeupDb)).toBeLessThan(UNITY_TOLERANCE_DB);
            expect(Math.abs(result.deviceLevelDb)).toBeLessThan(UNITY_TOLERANCE_DB);
        });

        test(`on renders the previous graph sample for sample at threshold ${thresholdDb} dB`, async ({
            page,
        }, testInfo) => {
            const result = await render(page, {
                thresholdDb,
                ceilingDb: -0.3,
                autoMakeup: 1,
                signal: { kind: 'steady', levelDbfs: LOUD_LEVEL_DBFS },
            });
            await attach(testInfo, 'render-metrics', result);
            expect(result.residualDbfs).toBeLessThanOrEqual(RESIDUAL_BUDGET_DBFS);
        });
    }

    test('off leaves a quiet sine at the declared ceiling gain and nothing more', async ({ page }, testInfo) => {
        const result = await render(page, {
            thresholdDb: -24,
            ceilingDb: -0.3,
            autoMakeup: 0,
            signal: { kind: 'sine', levelDbfs: QUIET_SINE_PEAK_DBFS },
        });
        await attach(testInfo, 'render-metrics', result);
        expect(Math.abs(result.deviceLevelDb - -0.3)).toBeLessThan(UNITY_TOLERANCE_DB);
    });

    test('off leaves a steady loud level on the uncompensated static curve', async ({ page }, testInfo) => {
        const result = await render(page, {
            thresholdDb: -24,
            ceilingDb: 0,
            autoMakeup: 0,
            signal: { kind: 'steady', levelDbfs: LOUD_LEVEL_DBFS },
        });
        await attach(testInfo, 'render-metrics', result);
        expect(Math.abs(result.deviceLevelDb - result.staticOutputDb)).toBeLessThan(LAW_TOLERANCE_DB);
    });

    test('a stored limiter without the switch keeps its +13.68 dB at threshold -24 dB, sample for sample', async ({
        page,
    }, testInfo) => {
        const result = await render(page, {
            thresholdDb: -24,
            ceilingDb: 0,
            signal: { kind: 'sine', levelDbfs: QUIET_SINE_PEAK_DBFS },
            readAsStored: true,
        });
        await attach(testInfo, 'render-metrics', result);
        expect(result.residualDbfs).toBeLessThanOrEqual(RESIDUAL_BUDGET_DBFS);
        expect(Math.abs(result.deviceLevelDb - 13.68)).toBeLessThan(UNITY_TOLERANCE_DB);
    });

    test('off follows automation of threshold and release together', async ({ page }, testInfo) => {
        const metrics = await page.evaluate(
            async ({ sampleRate, durationSeconds }) => {
                const [
                    { createWebAudioDevice },
                    { scheduleTrackAutomation },
                    { isDeviceParameterAutomatable },
                    { clampDeviceParameterValue },
                    { quantiseDeviceParameterValue },
                    { getAutomationLaneCeiling },
                    { automationSlewTickSecondsForGrain },
                ] = await Promise.all([
                    import('/src/modules/AudioEngine/repositories/deviceStrategy/WebAudioDeviceStrategy.ts'),
                    import('/src/modules/AudioEngine/repositories/offlineScheduler/automationScheduling.ts'),
                    import('/src/modules/Arrangement/useCases/isDeviceParameterAutomatable.ts'),
                    import('/src/modules/Arrangement/useCases/clampDeviceParameterValue.ts'),
                    import('/src/modules/Arrangement/useCases/quantiseDeviceParameterValue.ts'),
                    import('/src/modules/Automation/useCases/automation/getAutomationLaneCeiling.ts'),
                    import('/src/utils/automationSlew.ts'),
                ]);
                const frameCount = sampleRate * durationSeconds;
                const context = new OfflineAudioContext(2, frameCount, sampleRate);
                const merger = context.createChannelMerger(2);
                merger.connect(context.destination);
                const target = { 'lim-threshold': -24, 'lim-release': 250 };
                const contrast = { 'lim-threshold': -3, 'lim-release': 30 };
                const common = { 'lim-ceiling': 0, 'lim-auto-makeup': 0 };
                const staticDevice = createWebAudioDevice(context, {
                    id: 'static',
                    name: 'Limiter',
                    type: 'builtin-limiter',
                    bypassed: false,
                    parameterValues: { ...common, ...target },
                });
                const automatedValues = { ...common, ...contrast };
                const automatedDevice = createWebAudioDevice(context, {
                    id: 'automated',
                    name: 'Limiter',
                    type: 'builtin-limiter',
                    bypassed: false,
                    parameterValues: automatedValues,
                });
                staticDevice.node.outputNode.connect(merger, 0, 0);
                automatedDevice.node.outputNode.connect(merger, 0, 1);

                const buffer = context.createBuffer(1, frameCount, sampleRate);
                const samples = buffer.getChannelData(0);
                for (let frame = 0; frame < frameCount; frame++) {
                    const envelope = frame / sampleRate < 0.5 ? 10 ** (-50 / 20) : 10 ** (-3 / 20);
                    samples[frame] = envelope * Math.sin((2 * Math.PI * 997 * frame) / sampleRate);
                }
                const source = context.createBufferSource();
                source.buffer = buffer;
                source.connect(staticDevice.node.inputNode);
                source.connect(automatedDevice.node.inputNode);

                const lanes: AutomationLane[] = Object.entries(target).map(([parameterId, value]) => ({
                    id: `lane-${parameterId}`,
                    trackId: 'track-1',
                    parameterId: `automated:${parameterId}`,
                    parameterName: parameterId,
                    points: [{ beat: 0, value, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: -30,
                    maxValue: 500,
                }));
                const bindings = Object.keys(target).map(
                    (parameterId) => automatedDevice.resolveOfflineAutomation(parameterId)?.kind ?? null
                );
                const twinTargets = Object.keys(target).map((parameterId) => {
                    const binding = automatedDevice.resolveOfflineAutomation(parameterId);
                    return binding?.kind === 'audioParam' ? binding.targets.length : 0;
                });
                scheduleTrackAutomation({
                    lanes,
                    trackId: 'track-1',
                    trackGainNode: { gain: context.createGain().gain },
                    trackPanNode: { pan: context.createStereoPanner().pan },
                    deviceEntries: [
                        {
                            deviceId: 'automated',
                            deviceType: 'builtin-limiter',
                            contributesAudio: true,
                            strategy: automatedDevice,
                        },
                    ],
                    durationSeconds,
                    changes: [],
                    projectBeatToSeconds: (beat) => (beat / 120) * 60,
                    slewTickSeconds: automationSlewTickSecondsForGrain(10),
                    deviceParameterLaw: {
                        acceptsAutomation: ({ deviceId, deviceType, parameterId }) =>
                            deviceId === 'automated' &&
                            Object.hasOwn(automatedValues, parameterId) &&
                            isDeviceParameterAutomatable({ deviceType, paramId: parameterId }),
                        clampValue: ({ deviceType, paramId, value }) =>
                            clampDeviceParameterValue({ deviceType, paramId, value }),
                        quantiseValue: ({ deviceType, paramId, value }) =>
                            quantiseDeviceParameterValue({ deviceType, paramId, value }),
                    },
                    resolveLaneCeiling: getAutomationLaneCeiling,
                });
                source.start(0);
                const rendered = await context.startRendering();
                const staticSamples = rendered.getChannelData(0);
                const automatedSamples = rendered.getChannelData(1);
                const quietEnd = Math.round(0.5 * sampleRate);
                let residual = 0;
                let quietSum = 0;
                for (let frame = 0; frame < rendered.length; frame++) {
                    residual = Math.max(residual, Math.abs(staticSamples[frame] - automatedSamples[frame]));
                    if (frame >= quietEnd / 2 && frame < quietEnd) {
                        quietSum += automatedSamples[frame] * automatedSamples[frame];
                    }
                }
                const quietReferenceDb = -50 - 10 * Math.log10(2);
                return {
                    bindings,
                    twinTargets,
                    automatedQuietLevelDb: 10 * Math.log10(quietSum / (quietEnd / 2)) - quietReferenceDb,
                    residualDbfs: residual === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(residual),
                };
            },
            { sampleRate: SAMPLE_RATE, durationSeconds: DURATION_SECONDS }
        );
        await attach(testInfo, 'render-metrics', metrics);
        expect(metrics.bindings).toEqual(['audioParam', 'audioParam']);
        expect(metrics.twinTargets).toEqual([2, 2]);
        // The automated threshold sits at −24 dB, where the hidden gain is +13.68 dB; off cancels it.
        expect(Math.abs(metrics.automatedQuietLevelDb)).toBeLessThan(UNITY_TOLERANCE_DB);
        expect(metrics.residualDbfs).toBeLessThanOrEqual(-90);
    });
});

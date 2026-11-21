import { expect, test } from './e2eTest';

import type { AutomationLane } from '../../src/modules/Automation/models/Automation';

/**
 * The built-in compressor's Auto Makeup switch, rendered in real Chromium.
 *
 * Off: the output carries only the Makeup control, so a sine far below
 * threshold leaves at its input level, and a steady level above threshold
 * leaves where Chromium's own static curve puts it without the post-gain the
 * node adds. On, and a stored device that predates the switch, render the
 * graph the compressor had before the switch existed, sample for sample.
 */

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 1;
/** Frames before this are start-up: the envelope settles well inside it. */
const SETTLED_FROM_SECONDS = 0.5;
const UNITY_TOLERANCE_DB = 0.01;
const LAW_TOLERANCE_DB = 0.02;
const RESIDUAL_BUDGET_DBFS = -120;

type Curve = { threshold: number; ratio: number; knee: number };

const CURVES: readonly Curve[] = [
    { threshold: -20, ratio: 4, knee: 6 },
    { threshold: -40, ratio: 12, knee: 0 },
    { threshold: -10, ratio: 2, knee: 20 },
    { threshold: -60, ratio: 20, knee: 0 },
];

/** A sine at this peak sits 20 dB under the lowest threshold above, outside every knee. */
const QUIET_SINE_PEAK_DBFS = -80;
const LOUD_LEVEL_DBFS = -3;

type RenderRequest = {
    curve: Curve;
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
            const [{ createWebAudioDevice }, law, { migrateStoredDeviceParameterValues }] = await Promise.all([
                import('/src/modules/AudioEngine/repositories/deviceStrategy/WebAudioDeviceStrategy.ts'),
                import('/src/utils/dynamicsCompressorMakeupLaw.ts'),
                import('/src/modules/Arrangement/models/StoredDeviceParameterMigration.ts'),
            ]);
            const frameCount = sampleRate * durationSeconds;
            const context = new OfflineAudioContext(2, frameCount, sampleRate);
            const merger = context.createChannelMerger(2);
            merger.connect(context.destination);

            const stored: Record<string, number> = {
                'comp-threshold': request.curve.threshold,
                'comp-ratio': request.curve.ratio,
                'comp-attack': 10,
                'comp-release': 100,
                'comp-knee': request.curve.knee,
                'comp-makeup': 0,
            };
            if (request.autoMakeup !== undefined) {
                stored['comp-auto-makeup'] = request.autoMakeup;
            }
            let parameterValues = stored;
            if (request.readAsStored) {
                parameterValues = migrateStoredDeviceParameterValues('builtin-compressor', stored);
            }
            const device = createWebAudioDevice(context, {
                id: 'device-1',
                name: 'Compressor',
                type: 'builtin-compressor',
                bypassed: false,
                parameterValues,
            });

            // The compressor's graph before the switch existed: the node, then
            // the makeup gain, with the same settings.
            const previous = context.createDynamicsCompressor();
            previous.threshold.value = request.curve.threshold;
            previous.ratio.value = request.curve.ratio;
            previous.attack.value = 0.01;
            previous.release.value = 0.1;
            previous.knee.value = request.curve.knee;
            const previousMakeup = context.createGain();
            previousMakeup.gain.value = 1;
            previous.connect(previousMakeup);

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
            previousMakeup.connect(merger, 0, 1);
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
            return {
                deviceLevelDb: levelDb(deviceSamples, meanSquareReferenceDb),
                previousGraphLevelDb: levelDb(previousSamples, meanSquareReferenceDb),
                residualDbfs: residual === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(residual),
                hiddenMakeupDb: law.dynamicsCompressorHiddenMakeupDb({
                    thresholdDb: request.curve.threshold,
                    kneeDb: request.curve.knee,
                    ratio: request.curve.ratio,
                }),
                staticOutputDb: law.dynamicsCompressorStaticOutputDb(
                    {
                        thresholdDb: request.curve.threshold,
                        kneeDb: request.curve.knee,
                        ratio: request.curve.ratio,
                    },
                    request.signal.levelDbfs
                ),
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

const label = ({ threshold, ratio, knee }: Curve): string =>
    `threshold ${threshold} dB, ratio ${ratio}, knee ${knee} dB`;

test.describe('built-in compressor Auto Makeup', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    for (const curve of CURVES) {
        test(`off passes a quiet sine at unity at ${label(curve)}`, async ({ page }, testInfo) => {
            const result = await render(page, {
                curve,
                autoMakeup: 0,
                signal: { kind: 'sine', levelDbfs: QUIET_SINE_PEAK_DBFS },
            });
            await testInfo.attach('render-metrics', {
                body: JSON.stringify(result, null, 2),
                contentType: 'application/json',
            });
            // The previous graph adds the hidden makeup; off removes exactly that.
            expect(Math.abs(result.previousGraphLevelDb - result.hiddenMakeupDb)).toBeLessThan(UNITY_TOLERANCE_DB);
            expect(Math.abs(result.deviceLevelDb)).toBeLessThan(UNITY_TOLERANCE_DB);
        });

        test(`off leaves a steady loud level on the uncompensated static curve at ${label(curve)}`, async ({
            page,
        }, testInfo) => {
            const result = await render(page, {
                curve,
                autoMakeup: 0,
                signal: { kind: 'steady', levelDbfs: LOUD_LEVEL_DBFS },
            });
            await testInfo.attach('render-metrics', {
                body: JSON.stringify(result, null, 2),
                contentType: 'application/json',
            });
            expect(Math.abs(result.deviceLevelDb - result.staticOutputDb)).toBeLessThan(LAW_TOLERANCE_DB);
            expect(
                Math.abs(result.previousGraphLevelDb - (result.staticOutputDb + result.hiddenMakeupDb))
            ).toBeLessThan(LAW_TOLERANCE_DB);
        });

        test(`on renders the previous graph sample for sample at ${label(curve)}`, async ({ page }, testInfo) => {
            const result = await render(page, {
                curve,
                autoMakeup: 1,
                signal: { kind: 'steady', levelDbfs: LOUD_LEVEL_DBFS },
            });
            await testInfo.attach('render-metrics', {
                body: JSON.stringify(result, null, 2),
                contentType: 'application/json',
            });
            expect(result.residualDbfs).toBeLessThanOrEqual(RESIDUAL_BUDGET_DBFS);
        });
    }

    test('a stored compressor without the switch renders the previous graph sample for sample', async ({
        page,
    }, testInfo) => {
        for (const signal of [
            { kind: 'sine', levelDbfs: QUIET_SINE_PEAK_DBFS },
            { kind: 'steady', levelDbfs: LOUD_LEVEL_DBFS },
        ] as const) {
            const result = await render(page, { curve: CURVES[0], signal, readAsStored: true });
            await testInfo.attach(`render-metrics-${signal.kind}`, {
                body: JSON.stringify(result, null, 2),
                contentType: 'application/json',
            });
            expect(result.residualDbfs).toBeLessThanOrEqual(RESIDUAL_BUDGET_DBFS);
            expect(result.hiddenMakeupDb).toBeGreaterThan(1);
        }
    });

    test('off follows automation of threshold, ratio and knee together', async ({ page }, testInfo) => {
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
                const target = { 'comp-threshold': -40, 'comp-ratio': 12, 'comp-knee': 0 };
                const contrast = { 'comp-threshold': -10, 'comp-ratio': 2, 'comp-knee': 20 };
                const common = { 'comp-attack': 10, 'comp-release': 100, 'comp-makeup': 0, 'comp-auto-makeup': 0 };
                const staticDevice = createWebAudioDevice(context, {
                    id: 'static',
                    name: 'Compressor',
                    type: 'builtin-compressor',
                    bypassed: false,
                    parameterValues: { ...common, ...target },
                });
                const automatedValues = { ...common, ...contrast };
                const automatedDevice = createWebAudioDevice(context, {
                    id: 'automated',
                    name: 'Compressor',
                    type: 'builtin-compressor',
                    bypassed: false,
                    parameterValues: automatedValues,
                });
                staticDevice.node.outputNode.connect(merger, 0, 0);
                automatedDevice.node.outputNode.connect(merger, 0, 1);

                const buffer = context.createBuffer(1, frameCount, sampleRate);
                const samples = buffer.getChannelData(0);
                for (let frame = 0; frame < frameCount; frame++) {
                    const envelope = frame / sampleRate < 0.5 ? 10 ** (-80 / 20) : 10 ** (-3 / 20);
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
                    minValue: -60,
                    maxValue: 30,
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
                            deviceType: 'builtin-compressor',
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
                let residual = 0;
                let staticPeak = 0;
                for (let frame = 0; frame < rendered.length; frame++) {
                    staticPeak = Math.max(staticPeak, Math.abs(staticSamples[frame]));
                    residual = Math.max(residual, Math.abs(staticSamples[frame] - automatedSamples[frame]));
                }
                return {
                    bindings,
                    twinTargets,
                    staticPeak,
                    residualDbfs: residual === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(residual),
                };
            },
            { sampleRate: SAMPLE_RATE, durationSeconds: DURATION_SECONDS }
        );
        await testInfo.attach('render-metrics', {
            body: JSON.stringify(metrics, null, 2),
            contentType: 'application/json',
        });
        expect(metrics.bindings).toEqual(['audioParam', 'audioParam', 'audioParam']);
        expect(metrics.twinTargets).toEqual([2, 2, 2]);
        expect(metrics.staticPeak).toBeGreaterThan(0.01);
        expect(metrics.residualDbfs).toBeLessThanOrEqual(-90);
    });
});

import { expect, test } from '@playwright/test';

import type { AutomationLane } from '../../src/modules/Automation/models/Automation';

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 0.5;
const FRAME_COUNT = SAMPLE_RATE * DURATION_SECONDS;
const RESIDUAL_BUDGET_DBFS = -90;

type Case = {
    name: string;
    deviceType: 'builtin-gain' | 'builtin-compressor' | 'builtin-limiter';
    parameterId: string;
    /** What the static device holds and what the lane drives the automated side to. */
    targetValue: number;
    /** What the automated device holds before the lane writes — must differ from the target. */
    contrastValue: number;
    /** The device's other parameters, identical on both channels. */
    parameterValues: Record<string, number>;
    signal: 'steady' | 'dynamics';
};

/**
 * Each case automates a parameter whose offline binding is a real `AudioParam`.
 *
 * `lim-ceiling` is absent because it is frame-addressed rather than
 * param-addressed: its cap is the clipper's rebuilt WaveShaper curve, so
 * `WebAudioDeviceStrategy` answers a `curveWrite` binding and
 * `scheduleTrackAutomation` writes it at each automation frame through the
 * render's frame scheduler (#4437). This harness schedules its own graph and
 * passes none, so a ceiling case here would fail closed rather than render two
 * statically-configured limiters; the curve write itself is pinned by the
 * scheduler-level specs. The in-page `bindingResolved` assertion fails loudly if
 * a future binding change leaves a case aimed at an unbound parameter.
 *
 * Each case builds the automated device holding `contrastValue`, writes
 * `targetValue` into the static device, and drives the lane to `targetValue`. A
 * lane that is dropped, unapplied, or never scheduled therefore leaves the
 * automated channel at the contrast and pushes the residual outside the bound,
 * while a working constant lane writes the target from frame 0 — the offline
 * slew seeds `y[0]` from the curve at the window start, so a single-point lane
 * applies immediately rather than gliding in — and renders bit-identically to
 * the static device for the whole buffer. No settled window is excluded, because
 * a constant lane has no entry transient to exclude.
 */
const CASES: readonly Case[] = [
    {
        name: 'builtin gain at 0 dB',
        deviceType: 'builtin-gain',
        parameterId: 'gain-level',
        targetValue: 0,
        contrastValue: -12,
        parameterValues: { 'gain-level': 0 },
        signal: 'steady',
    },
    {
        name: 'builtin gain at -6 dB',
        deviceType: 'builtin-gain',
        parameterId: 'gain-level',
        targetValue: -6,
        contrastValue: -18,
        parameterValues: { 'gain-level': -6 },
        signal: 'steady',
    },
    {
        name: 'compressor makeup at +6 dB',
        deviceType: 'builtin-compressor',
        parameterId: 'comp-makeup',
        targetValue: 6,
        contrastValue: 18,
        parameterValues: {
            'comp-threshold': 0,
            'comp-ratio': 1,
            'comp-attack': 10,
            'comp-release': 100,
            'comp-knee': 0,
            'comp-makeup': 6,
        },
        signal: 'steady',
    },
    {
        name: 'limiter threshold at -24 dB',
        deviceType: 'builtin-limiter',
        parameterId: 'lim-threshold',
        targetValue: -24,
        contrastValue: 0,
        parameterValues: { 'lim-threshold': -24, 'lim-release': 100, 'lim-ceiling': 0 },
        signal: 'dynamics',
    },
    {
        name: 'compressor attack at 10 ms',
        deviceType: 'builtin-compressor',
        parameterId: 'comp-attack',
        targetValue: 10,
        contrastValue: 100,
        parameterValues: {
            'comp-threshold': -24,
            'comp-ratio': 12,
            'comp-attack': 10,
            'comp-release': 100,
            'comp-knee': 0,
            'comp-makeup': 0,
        },
        signal: 'dynamics',
    },
    {
        name: 'compressor release at 100 ms',
        deviceType: 'builtin-compressor',
        parameterId: 'comp-release',
        targetValue: 100,
        contrastValue: 1_000,
        parameterValues: {
            'comp-threshold': -24,
            'comp-ratio': 12,
            'comp-attack': 10,
            'comp-release': 100,
            'comp-knee': 0,
            'comp-makeup': 0,
        },
        signal: 'dynamics',
    },
    {
        name: 'limiter release at 100 ms',
        deviceType: 'builtin-limiter',
        parameterId: 'lim-release',
        targetValue: 100,
        contrastValue: 400,
        parameterValues: { 'lim-threshold': -24, 'lim-release': 100, 'lim-ceiling': 0 },
        signal: 'dynamics',
    },
];

for (const input of CASES) {
    test(`renders static and constant automated ${input.name} identically`, async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        await page.goto('/');

        const metrics = await page.evaluate(async (caseInput) => {
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

            const sampleRate = 48_000;
            const durationSeconds = 0.5;
            const frameCount = sampleRate * durationSeconds;
            const context = new OfflineAudioContext(2, frameCount, sampleRate);
            const merger = context.createChannelMerger(2);
            merger.connect(context.destination);

            const device = {
                id: 'device-1',
                name: caseInput.deviceType,
                type: caseInput.deviceType,
                bypassed: false,
                parameterValues: caseInput.parameterValues,
            };
            // The automated channel starts at the contrast; the static channel
            // holds the target. Only the lane should close that gap.
            const automatedDevice = createWebAudioDevice(context, {
                ...device,
                parameterValues: {
                    ...caseInput.parameterValues,
                    [caseInput.parameterId]: caseInput.contrastValue,
                },
            });
            const staticDevice = createWebAudioDevice(context, device);
            staticDevice.setParam(caseInput.parameterId, caseInput.targetValue);
            staticDevice.node.outputNode.connect(merger, 0, 0);
            automatedDevice.node.outputNode.connect(merger, 0, 1);

            // An unbound parameter makes `resolveOfflineAutomation` return null,
            // the scheduler skip the lane, and this case compare two statics.
            const binding = automatedDevice.resolveOfflineAutomation(caseInput.parameterId);

            const sourceBuffer = context.createBuffer(1, frameCount, sampleRate);
            const samples = sourceBuffer.getChannelData(0);
            for (let frame = 0; frame < samples.length; frame++) {
                const seconds = frame / sampleRate;
                let envelope = 0.125;
                if (caseInput.signal === 'dynamics') {
                    if (seconds < 0.05) {
                        envelope = 0.01;
                    } else if (seconds < 0.15) {
                        envelope = 0.8;
                    } else {
                        envelope = 0.08;
                    }
                }
                samples[frame] = envelope * Math.sin((2 * Math.PI * 997 * frame) / sampleRate);
            }
            const source = context.createBufferSource();
            source.buffer = sourceBuffer;
            source.connect(staticDevice.node.inputNode);
            source.connect(automatedDevice.node.inputNode);

            const lane: AutomationLane = {
                id: 'automation-1',
                trackId: 'track-1',
                parameterId: `device-1:${caseInput.parameterId}`,
                parameterName: caseInput.parameterId,
                points: [{ beat: 0, value: caseInput.targetValue, curve: 'linear', tension: 0 }],
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
                minValue: Math.min(-60, caseInput.targetValue),
                maxValue: Math.max(1_000, caseInput.targetValue),
            };
            scheduleTrackAutomation({
                lanes: [lane],
                trackId: 'track-1',
                trackGainNode: { gain: context.createGain().gain },
                trackPanNode: { pan: context.createStereoPanner().pan },
                deviceEntries: [
                    {
                        deviceId: device.id,
                        deviceType: device.type,
                        // Every case in this file renders a device the mixed
                        // signal and the residual budget both observe, so the
                        // strip prints.
                        contributesAudio: true,
                        strategy: automatedDevice,
                    },
                ],
                durationSeconds,
                defaultTempo: 120,
                changes: [],
                slewTickSeconds: automationSlewTickSecondsForGrain(10),
                deviceParameterLaw: {
                    acceptsAutomation: ({ deviceId, deviceType, parameterId }) =>
                        deviceId === device.id &&
                        device.parameterValues[parameterId] !== undefined &&
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
            let staticPeak = 0;
            let automatedPeak = 0;
            let residualPeak = 0;
            let nonFiniteSamples = 0;
            for (let frame = 0; frame < rendered.length; frame++) {
                const staticSample = staticSamples[frame];
                const automatedSample = automatedSamples[frame];
                if (!Number.isFinite(staticSample) || !Number.isFinite(automatedSample)) {
                    nonFiniteSamples++;
                }
                staticPeak = Math.max(staticPeak, Math.abs(staticSample));
                automatedPeak = Math.max(automatedPeak, Math.abs(automatedSample));
                residualPeak = Math.max(residualPeak, Math.abs(staticSample - automatedSample));
            }
            return {
                frameCount: rendered.length,
                sampleRate: rendered.sampleRate,
                bindingResolved: binding !== null,
                bindingKind: binding?.kind ?? null,
                staticPeak,
                automatedPeak,
                residualPeak,
                residualPeakDbfs: residualPeak === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(residualPeak),
                nonFiniteSamples,
            };
        }, input);

        await testInfo.attach('render-metrics', {
            body: JSON.stringify(metrics, null, 2),
            contentType: 'application/json',
        });
        expect(input.contrastValue).not.toBe(input.targetValue);
        expect(metrics.bindingResolved).toBe(true);
        expect(metrics.frameCount).toBe(FRAME_COUNT);
        expect(metrics.sampleRate).toBe(SAMPLE_RATE);
        expect(metrics.nonFiniteSamples).toBe(0);
        expect(metrics.staticPeak).toBeGreaterThan(0.01);
        expect(metrics.automatedPeak).toBeGreaterThan(0.01);
        expect(metrics.residualPeakDbfs).toBeLessThanOrEqual(RESIDUAL_BUDGET_DBFS);
    });
}

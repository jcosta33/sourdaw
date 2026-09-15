import { expect, test } from '@playwright/test';

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 0.5;
const FRAME_COUNT = SAMPLE_RATE * DURATION_SECONDS;
const RESIDUAL_BUDGET_DBFS = -90;

type Case = {
    name: string;
    deviceType: 'builtin-gain' | 'builtin-compressor' | 'builtin-limiter';
    parameterId: string;
    parameterValues: Record<string, number>;
    value: number;
    signal: 'steady' | 'dynamics';
};

const CASES: readonly Case[] = [
    {
        name: 'builtin gain at 0 dB',
        deviceType: 'builtin-gain',
        parameterId: 'gain-level',
        parameterValues: { 'gain-level': 0 },
        value: 0,
        signal: 'steady',
    },
    {
        name: 'builtin gain at -6 dB',
        deviceType: 'builtin-gain',
        parameterId: 'gain-level',
        parameterValues: { 'gain-level': -6 },
        value: -6,
        signal: 'steady',
    },
    {
        name: 'compressor makeup at +6 dB',
        deviceType: 'builtin-compressor',
        parameterId: 'comp-makeup',
        parameterValues: {
            'comp-threshold': 0,
            'comp-ratio': 1,
            'comp-attack': 10,
            'comp-release': 100,
            'comp-knee': 0,
            'comp-makeup': 6,
        },
        value: 6,
        signal: 'steady',
    },
    {
        name: 'limiter ceiling at -0.3 dB',
        deviceType: 'builtin-limiter',
        parameterId: 'lim-ceiling',
        parameterValues: { 'lim-threshold': 0, 'lim-release': 100, 'lim-ceiling': -0.3 },
        value: -0.3,
        signal: 'steady',
    },
    {
        name: 'compressor attack at 10 ms',
        deviceType: 'builtin-compressor',
        parameterId: 'comp-attack',
        parameterValues: {
            'comp-threshold': -24,
            'comp-ratio': 12,
            'comp-attack': 10,
            'comp-release': 100,
            'comp-knee': 0,
            'comp-makeup': 0,
        },
        value: 10,
        signal: 'dynamics',
    },
    {
        name: 'compressor release at 100 ms',
        deviceType: 'builtin-compressor',
        parameterId: 'comp-release',
        parameterValues: {
            'comp-threshold': -24,
            'comp-ratio': 12,
            'comp-attack': 10,
            'comp-release': 100,
            'comp-knee': 0,
            'comp-makeup': 0,
        },
        value: 100,
        signal: 'dynamics',
    },
    {
        name: 'limiter release at 100 ms',
        deviceType: 'builtin-limiter',
        parameterId: 'lim-release',
        parameterValues: { 'lim-threshold': -24, 'lim-release': 100, 'lim-ceiling': 0 },
        value: 100,
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
            const staticDevice = createWebAudioDevice(context, device);
            const automatedDevice = createWebAudioDevice(context, device);
            staticDevice.node.outputNode.connect(merger, 0, 0);
            automatedDevice.node.outputNode.connect(merger, 0, 1);

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

            const lane = {
                id: 'automation-1',
                trackId: 'track-1',
                parameterId: `device-1:${caseInput.parameterId}`,
                parameterName: caseInput.parameterId,
                points: [{ beat: 0, value: caseInput.value, curve: 'linear', tension: 0 }],
                enabled: true,
                minValue: Math.min(-60, caseInput.value),
                maxValue: Math.max(1_000, caseInput.value),
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
        expect(metrics.frameCount).toBe(FRAME_COUNT);
        expect(metrics.sampleRate).toBe(SAMPLE_RATE);
        expect(metrics.nonFiniteSamples).toBe(0);
        expect(metrics.staticPeak).toBeGreaterThan(0.01);
        expect(metrics.automatedPeak).toBeGreaterThan(0.01);
        expect(metrics.residualPeakDbfs).toBeLessThanOrEqual(RESIDUAL_BUDGET_DBFS);
    });
}

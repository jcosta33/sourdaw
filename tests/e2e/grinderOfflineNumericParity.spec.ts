import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

test('public Web Audio export renders persisted Grinder numeric capture controls', async ({ page }) => {
    test.setTimeout(120_000);
    await setupWorkspace(page);
    await launch_new_project(page);

    const rendered = await page.evaluate(
        async (urls) => {
            const command: typeof import('../../src/modules/Command/useCases') = await import(urls.command);
            const arrangement: typeof import('../../src/modules/Arrangement/useCases') = await import(urls.arrangement);
            const audio: typeof import('../../src/modules/AudioEngine/useCases') = await import(urls.audio);
            if (!crossOriginIsolated || typeof OfflineAudioContext !== 'function') {
                throw new Error('The public Grinder render requires real isolated Web Audio');
            }
            const sampleRate = 48_000;
            const trackId = crypto.randomUUID();
            const deviceId = crypto.randomUUID();
            await command.executeAppAction({ type: 'setTempo', payload: { bpm: 120 } });
            await command.executeAppAction({
                type: 'addTrack',
                payload: { id: trackId, name: 'Grinder numeric export', kind: 'audio' },
            });
            const source = new AudioBuffer({ numberOfChannels: 2, length: sampleRate * 2, sampleRate });
            for (let channel = 0; channel < source.numberOfChannels; channel++) {
                const samples = source.getChannelData(channel);
                for (let frame = 0; frame < samples.length; frame++) {
                    samples[frame] = 0.05 * Math.sin((2 * Math.PI * 220 * frame) / sampleRate);
                }
            }
            const audioBufferId = audio.cacheAudioBuffer({ buffer: source });
            await command.executeAppAction({
                type: 'addClip',
                payload: {
                    trackId,
                    name: 'Deterministic guitar input',
                    startBeat: 0,
                    endBeat: 4,
                    type: 'audio',
                    audioBufferId,
                },
            });
            await command.executeAppAction({
                type: 'addDevice',
                payload: { trackId, deviceId, deviceType: 'grinder' },
            });

            async function setParam(paramId: string, value: number): Promise<void> {
                await command.executeAppAction({
                    type: 'setDeviceParameter',
                    payload: { deviceId, paramId, value, automationRecordingPolicy: 'suppressed' },
                });
                if (arrangement.getEligibleDeviceParameterValues(deviceId)?.[paramId] !== value) {
                    throw new Error(`The project did not retain Grinder ${paramId}=${String(value)}`);
                }
            }

            // Rig capture bypasses the circuit/cabinet path. After the 40 ms
            // warmup, neural.rs multiplies the same profile signal by output_trim.
            // No model asset or modelJson is installed by this fixture.
            const parameters = {
                neuralEnabled: 1,
                engineMode: 1,
                neuralPlacement: 1,
                neuralMix: 1,
                neuralModelMode: 1,
                neuralCustomTier: 0,
                neuralCustomInputDrive: 1,
                neuralCustomAsymmetry: 0,
                neuralCustomContourMix: 0,
                neuralCustomLstmBias: 0,
                limiterEnabled: 0,
                gateEnabled: 0,
                fat: 0,
                outputMix: 1,
                cleanBlend: 0,
            };
            for (const [name, value] of Object.entries(parameters)) {
                await setParam(name, value);
            }

            async function render(): Promise<Float32Array[]> {
                const warnings: string[] = [];
                const buffer = await audio.renderOffline({
                    durationBeats: 4,
                    sampleRate,
                    tailSeconds: 0,
                    onWarning: (message) => warnings.push(message),
                });
                if (warnings.length > 0 || buffer.numberOfChannels !== 2 || buffer.sampleRate !== sampleRate) {
                    throw new Error(`The real Grinder render was degraded: ${warnings.join('; ')}`);
                }
                return Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
                    buffer.getChannelData(channel).slice()
                );
            }

            await setParam('neuralCustomOutputTrim', 0.2);
            const low = await render();
            await setParam('neuralCustomOutputTrim', 1.4);
            const high = await render();
            const repeated = await render();
            const ratio = 1.4 / 0.2;
            const warmupFrames = Math.ceil(sampleRate * 0.04) + 128;
            let lowEnergy = 0;
            let highEnergy = 0;
            let peak = 0;
            let residual = 0;
            let repeatDifference = 0;
            let finite = true;
            for (let channel = 0; channel < low.length; channel++) {
                const lowChannel = low[channel]!;
                const highChannel = high[channel]!;
                const repeatChannel = repeated[channel]!;
                if (lowChannel.length !== highChannel.length || highChannel.length !== repeatChannel.length) {
                    throw new Error('Repeated public renders changed frame count');
                }
                for (let frame = 0; frame < lowChannel.length; frame++) {
                    const a = lowChannel[frame]!;
                    const b = highChannel[frame]!;
                    const c = repeatChannel[frame]!;
                    finite = finite && Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c);
                    repeatDifference = Math.max(repeatDifference, Math.abs(b - c));
                    if (frame >= warmupFrames) {
                        lowEnergy += a * a;
                        highEnergy += b * b;
                        peak = Math.max(peak, Math.abs(b));
                        residual = Math.max(residual, Math.abs(b - ratio * a));
                    }
                }
            }

            await setParam('neuralModelMode', 0);
            await setParam('neuralModelSlot', 0);
            const firstBuiltin = await render();
            await setParam('neuralModelSlot', 1);
            const secondBuiltin = await render();
            let builtinDifference = 0;
            for (let channel = 0; channel < firstBuiltin.length; channel++) {
                const first = firstBuiltin[channel]!;
                const second = secondBuiltin[channel]!;
                for (let frame = warmupFrames; frame < first.length; frame++) {
                    if (!Number.isFinite(first[frame]) || !Number.isFinite(second[frame])) {
                        throw new Error('Builtin Grinder slot rendered non-finite PCM');
                    }
                    builtinDifference = Math.max(builtinDifference, Math.abs(first[frame]! - second[frame]!));
                }
            }
            return { finite, lowEnergy, highEnergy, peak, residual, repeatDifference, ratio, builtinDifference };
        },
        {
            command: '/src/modules/Command/useCases/index.ts',
            arrangement: '/src/modules/Arrangement/useCases/index.ts',
            audio: '/src/modules/AudioEngine/useCases/index.ts',
        }
    );

    expect(rendered.finite).toBe(true);
    expect(rendered.lowEnergy).toBeGreaterThan(0);
    expect(rendered.highEnergy).toBeGreaterThan(rendered.lowEnergy);
    expect(rendered.repeatDifference).toBe(0);
    // Float32 rounding at the DSP and Web Audio copies, scaled by measured PCM.
    const float32Epsilon = 2 ** -23;
    expect(rendered.residual).toBeLessThanOrEqual(rendered.peak * float32Epsilon * 16);
    expect(rendered.builtinDifference).toBeGreaterThan(0);
});

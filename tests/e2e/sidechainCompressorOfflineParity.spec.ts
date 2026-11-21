import { expect, test } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

// Live playback always builds the `sidechain-compressor-processor` worklet. With no key on
// input 1 it applies no gain reduction, only Makeup. An offline render of an unkeyed
// sidechain compressor must therefore match that worklet, not a self-keyed
// DynamicsCompressorNode with its own automatic makeup.
for (const route of ['mixdown', 'stems', 'freeze', 'bounce'] as const) {
    test(`an unkeyed sidechain compressor renders through its worklet on the ${route} route`, async ({ page }) => {
        test.setTimeout(120_000);
        await setupWorkspace(page);
        await launch_new_project(page);

        const measured = await page.evaluate(
            async (urls) => {
                const command: typeof import('../../src/modules/Command/useCases') = await import(urls.command);
                const audio: typeof import('../../src/modules/AudioEngine/useCases') = await import(urls.audio);
                const stores: typeof import('../../src/modules/Arrangement/stores') = await import(urls.stores);
                if (typeof OfflineAudioContext !== 'function') {
                    throw new TypeError('The sidechain parity render requires real Web Audio');
                }
                // Count the render's own worklet constructions: the degraded gain node
                // matches the worklet's unkeyed output too, so level alone cannot tell
                // that the render ran the processor live runs.
                let workletConstructions = 0;
                const OriginalWorkletNode = AudioWorkletNode;
                window.AudioWorkletNode = class extends OriginalWorkletNode {
                    constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
                        super(context, name, options);
                        // The live engine builds its own worklet on its AudioContext; only
                        // the renders' offline contexts count here.
                        if (context instanceof OfflineAudioContext && name === 'sidechain-compressor-processor') {
                            workletConstructions++;
                        }
                    }
                };
                const sampleRate = 48_000;
                const amplitude = 0.5;
                const trackId = crypto.randomUUID();
                const deviceId = crypto.randomUUID();
                await command.executeAppAction({ type: 'setTempo', payload: { bpm: 120 } });
                await command.executeAppAction({
                    type: 'addTrack',
                    payload: { id: trackId, name: 'Unkeyed sidechain', kind: 'audio' },
                });
                // Loud enough to sit above the compressor's default threshold, so a
                // self-keyed compressor would visibly reduce it.
                const source = new AudioBuffer({ numberOfChannels: 2, length: sampleRate * 2, sampleRate });
                for (let channel = 0; channel < source.numberOfChannels; channel++) {
                    const samples = source.getChannelData(channel);
                    for (let frame = 0; frame < samples.length; frame++) {
                        samples[frame] = amplitude * Math.sin((2 * Math.PI * 220 * frame) / sampleRate);
                    }
                }
                const audioBufferId = audio.cacheAudioBuffer({ buffer: source });
                await command.executeAppAction({
                    type: 'addClip',
                    payload: {
                        trackId,
                        name: 'Loud sine',
                        startBeat: 0,
                        endBeat: 4,
                        type: 'audio',
                        audioBufferId,
                    },
                });

                function rms(buffer: AudioBuffer): number {
                    let sum = 0;
                    let count = 0;
                    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                        for (const sample of buffer.getChannelData(channel)) {
                            sum += sample * sample;
                            count++;
                        }
                    }
                    return Math.sqrt(sum / count);
                }

                const warnings: string[] = [];
                async function render(): Promise<AudioBuffer> {
                    const options = {
                        durationBeats: 4,
                        sampleRate,
                        tailSeconds: 0,
                        onWarning: (message: string) => warnings.push(message),
                    };
                    let buffer: AudioBuffer | null | undefined;
                    if (urls.route === 'mixdown') {
                        buffer = await audio.renderOffline(options);
                    } else if (urls.route === 'stems') {
                        buffer = (await audio.exportStems(options)).get(trackId);
                    } else {
                        const track = stores.trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
                        if (!track) {
                            throw new Error('The subgraph render requires its persisted track');
                        }
                        buffer = await audio.renderTrackSubgraphOffline({
                            targetTrackId: trackId,
                            renderTracks: [track],
                            startBeat: 0,
                            endBeat: 4,
                            tailSeconds: 0,
                            targetMixer: urls.route === 'freeze' ? 'keepLive' : 'bake',
                            onWarning: options.onWarning,
                        });
                    }
                    if (!buffer) {
                        throw new Error('The render produced no buffer');
                    }
                    return buffer;
                }

                // The live device: the worklet itself, built the way TrackNode builds it,
                // fed the same input with no key connected.
                async function workletGain(makeupDb: number): Promise<number> {
                    const context = new OfflineAudioContext(2, source.length, sampleRate);
                    await context.audioWorklet.addModule('/audio/worklets/sidechain-compressor-processor.js');
                    const node = new AudioWorkletNode(context, 'sidechain-compressor-processor', {
                        numberOfInputs: 2,
                        numberOfOutputs: 1,
                        outputChannelCount: [2],
                    });
                    const makeup = node.parameters.get('makeup');
                    if (!makeup) {
                        throw new Error('The sidechain worklet exposes no makeup parameter');
                    }
                    makeup.value = makeupDb;
                    const input = new AudioBufferSourceNode(context, { buffer: source });
                    input.connect(node);
                    node.connect(context.destination);
                    input.start();
                    return rms(await context.startRendering()) / rms(source);
                }

                const baseline = rms(await render());
                await command.executeAppAction({
                    type: 'addDevice',
                    payload: { trackId, deviceId, deviceType: 'builtin-sidechain-compressor' },
                });
                const unity = rms(await render()) / baseline;
                await command.executeAppAction({
                    type: 'setDeviceParameter',
                    payload: {
                        deviceId,
                        paramId: 'sc-comp-makeup',
                        value: 6,
                        automationRecordingPolicy: 'suppressed',
                    },
                });
                const boosted = rms(await render()) / baseline;
                const renderConstructions = workletConstructions;
                return {
                    renderConstructions,
                    warnings,
                    unity,
                    boosted,
                    liveUnity: await workletGain(0),
                    liveBoosted: await workletGain(6),
                };
            },
            {
                command: '/src/modules/Command/useCases/index.ts',
                audio: '/src/modules/AudioEngine/useCases/index.ts',
                stores: '/src/modules/Arrangement/stores/index.ts',
                route,
            }
        );

        expect(measured.warnings).toEqual([]);
        // Two renders carried the device (Makeup 0 dB, then 6 dB), each building the worklet.
        expect(measured.renderConstructions).toBeGreaterThanOrEqual(2);
        // The live worklet passes an unkeyed signal at Makeup 0 dB unchanged.
        expect(measured.liveUnity).toBeCloseTo(1, 4);
        expect(measured.liveBoosted).toBeCloseTo(10 ** (6 / 20), 4);
        // The offline render of the same device must match it.
        expect(measured.unity).toBeCloseTo(measured.liveUnity, 4);
        expect(measured.boosted).toBeCloseTo(measured.liveBoosted, 4);
    });
}

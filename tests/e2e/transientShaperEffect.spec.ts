import { writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import { expect, test, type Page } from '@playwright/test';

import { admitLoopbackProvider } from './admitLoopbackProvider';
import { launch_new_project, setupWorkspace } from './e2eUtils';
import { literalWholeRequestIntake, startScriptedToolProvider, type ScriptedToolRequest } from './scriptedToolProvider';

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function receipt(request: ScriptedToolRequest, id: string) {
    const item = request.messages.find((message) => message.role === 'tool' && message.tool_call_id === id);
    if (typeof item?.content !== 'string') throw new Error(`Missing receipt ${id}`);
    const value: unknown = JSON.parse(item.content);
    if (!record(value) || value.status !== 'success' || !record(value.data))
        throw new Error(`Failed receipt ${id}: ${item.content}`);
    return value.data;
}
function tool(request: ScriptedToolRequest, name: string) {
    const wire = name.replaceAll('.', '_');
    const found = request.tools.find((entry) => entry.function.name === wire);
    if (!found) throw new Error(`Application did not offer ${name}`);
    return found.function.name;
}
async function sourceState(page: Page) {
    return page.evaluate(async () => {
        const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
        const { audioBufferCache } = await import('/src/modules/AudioEngine/stores/index.ts');
        const { undoHistoryStore } = await import('/src/modules/Command/stores/index.ts');
        const { getCrdtDoc, captureProjectRevision, settlePendingProjectWritesAndCaptureRevision } =
            await import('/src/modules/CrdtDocument/useCases/index.ts');
        settlePendingProjectWritesAndCaptureRevision();
        const tracks = (trackStore.value?.tracks ?? []).filter((track) => track.kind === 'audio');
        const clip = tracks[0]?.clips[0];
        const source = clip?.audioBufferId ? audioBufferCache.get(clip.audioBufferId) : undefined;
        if (!source) throw new Error('Actual source PCM is unavailable');
        const hashes = [];
        for (let channel = 0; channel < source.numberOfChannels; channel++) {
            const data = source.getChannelData(channel).slice();
            hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer))).join(','));
        }
        return {
            tracks,
            hashes,
            document: JSON.stringify(getCrdtDoc('root')),
            revision: captureProjectRevision(),
            history: JSON.stringify(undoHistoryStore.value),
        };
    });
}
async function rendered(page: Page) {
    return page.evaluate(async () => {
        const { renderOffline } = await import('/src/modules/AudioEngine/useCases/index.ts');
        const warnings: string[] = [];
        const audio = await renderOffline({
            durationBeats: 2,
            sampleRate: 48000,
            tailSeconds: 0,
            onWarning: (message: string) => warnings.push(message),
        });
        const hashes = [];
        let energy = 0;
        let peak = 0;
        for (let channel = 0; channel < audio.numberOfChannels; channel++) {
            const data = audio.getChannelData(channel).slice();
            hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer))).join(','));
            for (const sample of data) {
                if (!Number.isFinite(sample)) throw new Error('Rendered nonfinite audio');
                energy += sample * sample;
                peak = Math.max(peak, Math.abs(sample));
            }
        }
        return { hashes, energy, peak, warnings, frames: audio.length, channels: audio.numberOfChannels };
    });
}
async function seedAudio(page: Page, channels: number) {
    return page.evaluate(async (channels) => {
        const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
        const { cacheAudioBuffer } = await import('/src/modules/AudioEngine/useCases/index.ts');
        const trackId = crypto.randomUUID();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 120 } });
        await executeAppAction({ type: 'addTrack', payload: { id: trackId, name: 'Close Drums', kind: 'audio' } });
        const source = new AudioBuffer({ length: 48000, numberOfChannels: channels, sampleRate: 48000 });
        for (let channel = 0; channel < channels; channel++) {
            const data = source.getChannelData(channel);
            for (let frame = 0; frame < data.length; frame++) {
                const relative = (frame + (channel === 1 ? 47 : 0)) % 12000;
                data[frame] =
                    (channel === 1 ? 0.12 : 0.25) *
                    Math.exp(-relative / 2400) *
                    Math.cos((2 * Math.PI * 150 * relative) / 48000);
            }
        }
        const audioBufferId = cacheAudioBuffer({ buffer: source });
        await executeAppAction({
            type: 'addClip',
            payload: {
                trackId,
                name: 'Deterministic close drums',
                startBeat: 0,
                endBeat: 2,
                type: 'audio',
                audioBufferId,
            },
        });
        return trackId;
    }, channels);
}

for (const recipe of [
    { id: 'drums-tight-transient', descriptor: 'tight', parameter: 'sustainGain', value: 0.625, channels: 1 },
    { id: 'drums-punchy-transient', descriptor: 'punchy', parameter: 'attackGain', value: 1.375, channels: 2 },
]) {
    test(`${recipe.id}: real provider discovery, Confirm, audio, Undo/Redo and durable save/load`, async ({
        page,
    }, testInfo) => {
        test.setTimeout(150000);
        await setupWorkspace(page);
        await launch_new_project(page);
        const trackId = await seedAudio(page, recipe.channels);
        const dry = await rendered(page);
        expect(dry.energy).toBeGreaterThan(0);
        expect(dry.warnings).toEqual([]);
        const provider = await startScriptedToolProvider((request, turn) => {
            expect(turn).toBeLessThan(5);
            if (turn === 0) {
                return [literalWholeRequestIntake(request)];
            }
            const step = turn - 1;
            if (step === 0)
                return [
                    {
                        id: 'project',
                        name: tool(request, 'project.query'),
                        arguments: { type: 'object', page: { limit: 50 } },
                    },
                ];
            if (step === 1) {
                receipt(request, 'project');
                return [
                    {
                        id: 'discover',
                        name: tool(request, 'recipe.discover'),
                        arguments: { descriptors: [recipe.descriptor], targetId: trackId, role: 'drums', limit: 8 },
                    },
                ];
            }
            if (step === 2) {
                const discovered = receipt(request, 'discover');
                expect(discovered.candidates).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            id: recipe.id,
                            steps: [expect.objectContaining({ deviceType: 'transient-shaper' })],
                        }),
                    ])
                );
                expect(JSON.stringify(discovered.candidates)).not.toContain('faust-noise-gate');
                return [
                    {
                        id: 'expand',
                        name: tool(request, 'recipe.expand'),
                        arguments: {
                            recipeId: recipe.id,
                            targetId: trackId,
                            role: 'drums',
                            values: [{ step: 0, paramId: recipe.parameter, value: recipe.value }],
                        },
                    },
                ];
            }
            const expanded = receipt(request, 'expand');
            expect(expanded.recipeId).toBe(recipe.id);
            expect(JSON.stringify(expanded)).not.toContain('_resetEpoch');
            return [
                {
                    id: 'proposal',
                    name: tool(request, 'command.batch.propose'),
                    arguments: {
                        commands: [],
                        compiledCallIds: ['expand'],
                        plan: {
                            semantic: { classification: 'complex', uncertainty: [] },
                            objective: `Apply ${recipe.id} to Close Drums.`,
                            constraints: [],
                            scope: {
                                targetIds: [trackId],
                                targetRanges: [],
                                protectedTargetIds: [],
                                protectedRanges: [],
                            },
                            capabilityIds: ['addDevice', 'setDeviceParameter'],
                            assetIds: [],
                            alternatives: [],
                            validationStrategy: ['Compare actual rendered drum audio and preserve source PCM.'],
                            stoppingConditions: ['Stop after one approved recipe batch.'],
                        },
                    },
                },
            ];
        });
        try {
            await admitLoopbackProvider(page, provider);
            await page.getByTestId('toggle-chat').click();
            await page.getByRole('combobox', { name: 'Agent execution mode' }).selectOption('apply');
            const composer = page.getByTestId('chat-composer-input');
            await expect(composer).toBeEnabled();
            const before = await sourceState(page);
            await composer.fill(
                `Add Transient Shaper to Close Drums and set its ${recipe.parameter} to ${recipe.value} using the catalog ${recipe.id} recipe. Prepare it for my confirmation.`
            );
            await composer.press('Enter');
            const confirm = page.getByRole('button', { name: 'Confirm pending actions', exact: true });
            await expect(confirm).toBeVisible({ timeout: 45000 });
            expect(provider.failures).toEqual([]);
            expect(provider.requests).toHaveLength(5);
            const proposed = await sourceState(page);
            expect(proposed.document).toBe(before.document);
            expect(proposed.revision).toBe(before.revision);
            expect(proposed.history).toBe(before.history);
            expect(proposed.hashes).toEqual(before.hashes);
            await confirm.click();
            await expect
                .poll(
                    async () =>
                        (await sourceState(page)).tracks[0]?.devices.filter(
                            (device) => device.type === 'transient-shaper'
                        ).length
                )
                .toBe(1);
            const committed = await sourceState(page);
            expect(committed.document).not.toContain('_resetEpoch');
            expect(committed.history).not.toContain('_resetEpoch');
            const device = committed.tracks[0].devices.find((device) => device.type === 'transient-shaper');
            expect(device?.parameterValues).toMatchObject({
                attackGain: recipe.parameter === 'attackGain' ? recipe.value : 1,
                sustainGain: recipe.parameter === 'sustainGain' ? recipe.value : 1,
            });
            expect(JSON.stringify(device)).not.toContain('_resetEpoch');
            const receipts = await page.evaluate(async () => {
                const { agentRunStore } = await import('/src/modules/AiRuntime/stores/index.ts');
                return (agentRunStore.value?.runs ?? []).flatMap((run) => run.receipts);
            });
            expect(receipts).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ receiptIdentity: expect.stringContaining(':committed') }),
                ])
            );
            const wet = await rendered(page);
            expect(wet.warnings).toEqual([]);
            expect(wet.hashes).not.toEqual(dry.hashes);
            expect(wet.energy).toBeGreaterThan(0);
            await page.getByTestId('transport-undo').click();
            await expect
                .poll(async () => (await sourceState(page)).tracks[0]?.devices.length)
                .toBe(before.tracks[0].devices.length);
            expect((await rendered(page)).hashes).toEqual(dry.hashes);
            await page.getByTestId('transport-redo').click();
            await expect
                .poll(async () => (await sourceState(page)).tracks[0]?.devices.length)
                .toBe(committed.tracks[0].devices.length);
            expect((await rendered(page)).hashes).toEqual(wet.hashes);
            const persistence = await page.evaluate(async () => {
                const { saveProject, loadRecentProject, getProjectSnapshotKey } =
                    await import('/src/modules/Project/useCases/index.ts');
                const { projectStore } = await import('/src/modules/Project/stores/index.ts');
                const createdAt = projectStore.value?.createdAt;
                if (createdAt === undefined) throw new Error('No current project identity to reopen');
                const saved = await saveProject();
                const loaded = saved
                    ? await loadRecentProject(getProjectSnapshotKey(createdAt), { requireDurable: true })
                    : 'not-attempted';
                return { saved, loaded };
            });
            await testInfo.attach('save-load-result', {
                body: JSON.stringify(persistence),
                contentType: 'application/json',
            });
            expect(persistence).toEqual({ saved: true, loaded: 'committed' });
            const restored = await sourceState(page);
            expect(restored.document).not.toContain('_resetEpoch');
            expect(restored.history).not.toContain('_resetEpoch');
            expect(restored.tracks[0].devices).toEqual(committed.tracks[0].devices);
            expect(restored.hashes).toEqual(before.hashes);
            expect((await rendered(page)).hashes).toEqual(wet.hashes);
            await testInfo.attach('command-and-audio-receipt', {
                body: JSON.stringify({ recipe, receipts, dry, wet, sourceHashes: before.hashes }),
                contentType: 'application/json',
            });
        } finally {
            await testInfo.attach('scripted-provider-evidence', {
                body: JSON.stringify({ requests: provider.requests, failures: provider.failures }),
                contentType: 'application/json',
            });
            await provider.close();
        }
    });
}

// Isolated browser probes use the shipping node and factory, with real Chromium
// audio. No app document or readiness flag is fabricated for these measurements.
async function probePage(page: Page) {
    const url = '/__transient-shaper-real-audio-probe';
    await page.route(`**${url}`, (route) =>
        route.fulfill({
            status: 200,
            contentType: 'text/html',
            headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
            body: '<!doctype html><title>Transient Shaper real audio proof</title>',
        })
    );
    await page.goto(url);
}

test('shipping Chromium worklet honors within-quantum automation and first re-entry reset', async ({
    page,
}, testInfo) => {
    await probePage(page);
    const result = await page.evaluate(async () => {
        const { createTransientShaperNode } = await import('/src/modules/AudioEngine/engine/TransientShaperNode.ts');
        const rate = 48000,
            frames = 48000;
        const context = new OfflineAudioContext(2, frames, rate);
        const node = await createTransientShaperNode(context);
        await node.ready;
        const source = context.createBufferSource();
        const buffer = context.createBuffer(2, frames, rate);
        buffer.getChannelData(0).fill(0.5);
        buffer.getChannelData(1).fill(0.001);
        source.buffer = buffer;
        source.connect(node.workletNode);
        node.workletNode.connect(context.destination);
        node.scheduleParam('attackGain', [
            { startFrame: 0, endFrame: 0, startValue: 1, endValue: 1 },
            { startFrame: 61, endFrame: 61, startValue: 1.5, endValue: 1.5 },
            { startFrame: 257, endFrame: 273, startValue: 2, endValue: 1 },
        ]);
        node.scheduleParam('sustainGain', [
            { startFrame: 0, endFrame: 0, startValue: 1, endValue: 1 },
            { startFrame: 129, endFrame: 129, startValue: 0.25, endValue: 0.25 },
        ]);
        const suspended = context.suspend(24064 / rate);
        source.start();
        const pending = context.startRendering();
        await suspended;
        node.setBypass(true);
        node.setParam('attackGain', 2);
        node.setParam('sustainGain', 0.25);
        node.setBypass(false);
        await context.resume();
        const audio = await pending;
        const left = audio.getChannelData(0),
            right = audio.getChannelData(1);
        const result = {
            left: [left[0], left[60], left[61], left[256], left[257], left[265], left[273], left[24063], left[24064]],
            right: [right[0], right[128], right[129], right[24064]],
            frames: audio.length,
        };
        node.destroy();
        return result;
    });
    expect(result.left).toEqual([0.5, 0.5, 0.75, 0.75, 1, 0.75, 0.5, 0.125, 1]);
    expect(result.right[0]).toBeCloseTo(0.001, 8);
    expect(result.right[1]).toBeCloseTo(0.001, 8);
    expect(result.right[2]).toBeCloseTo(0.00025, 8);
    expect(result.frames).toBe(48000);
    await testInfo.attach('chromium-real-audio', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('actual TrackNode factory and shipping offline strategy render the same gain lane and fresh coalesced re-entry', async ({
    page,
}, testInfo) => {
    test.setTimeout(90000);
    await setupWorkspace(page);
    await launch_new_project(page);
    const result = await page.evaluate(async () => {
        const command = await import('/src/modules/Command/useCases/index.ts');
        const audio = await import('/src/modules/AudioEngine/useCases/index.ts');
        const { createNativeDspStrategy } =
            await import('/src/modules/AudioEngine/repositories/deviceStrategy/NativeDspDeviceStrategy.ts');
        const context = audio.getAudioContext();
        await audio.resumeEngine();
        const trackId = crypto.randomUUID(),
            deviceId = crypto.randomUUID();
        await command.executeAppAction({
            type: 'addTrack',
            payload: { id: trackId, name: 'Actual shaper factory proof', kind: 'audio' },
        });
        const OriginalWorkletNode = window.AudioWorkletNode;
        let releaseInit: () => void = () => {
            throw new Error('Actual initialization not intercepted');
        };
        let observeInit = () => {};
        const initPending = new Promise<void>((resolve) => {
            observeInit = resolve;
        });
        try {
            window.AudioWorkletNode = class extends OriginalWorkletNode {
                constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
                    super(context, name, options);
                    if (name === 'transient-shaper-processor') {
                        const post = this.port.postMessage.bind(this.port);
                        this.port.postMessage = (message: unknown) => {
                            if (
                                message &&
                                typeof message === 'object' &&
                                'type' in message &&
                                message.type === 'init'
                            ) {
                                releaseInit = () => post(message);
                                observeInit();
                                return;
                            }
                            post(message);
                        };
                    }
                }
            };
            await command.executeAppAction({
                type: 'addDevice',
                payload: { trackId, deviceId, deviceType: 'transient-shaper' },
            });
            await initPending;
            for (const bypassed of [true, false, true]) {
                await command.executeAppAction({ type: 'bypassDevice', payload: { deviceId, bypassed } });
            }
            releaseInit();
            await audio.waitForDevices();
        } finally {
            window.AudioWorkletNode = OriginalWorkletNode;
        }
        const strip = audio.getTrackStrip(trackId);
        const device = strip?.deviceNodes.find((candidate) => candidate.deviceId === deviceId);
        if (!strip || !device?.controller?.ready) throw new Error('TrackNode did not promote actual ready WASM');
        const pendingFinalBypassed = device.bypassed;
        if (pendingFinalBypassed !== true) throw new Error('Pending bypass was not replayed at actual promotion');
        await command.executeAppAction({ type: 'bypassDevice', payload: { deviceId, bypassed: false } });
        const frames = 8192,
            rate = context.sampleRate;
        const recorderCode = `class ShaperCapture extends AudioWorkletProcessor {
            static get parameterDescriptors(){return [{name:'capture',defaultValue:0,automationRate:'k-rate'}];}
            constructor(options){super();this.start=options.processorOptions.start;this.count=0;this.firstFrame=-1;this.left=new Float32Array(options.processorOptions.frames);this.right=new Float32Array(options.processorOptions.frames);}
            process(inputs,outputs,params){for(let frame=0;frame<(outputs[0]?.[0]?.length??128);frame++){if(currentFrame+frame<this.start||params.capture[0]<0.5)continue;if(this.count<this.left.length){if(this.count===0)this.firstFrame=currentFrame+frame;this.left[this.count]=inputs[0]?.[0]?.[frame]??0;this.right[this.count]=inputs[0]?.[1]?.[frame]??0;this.count++;}}if(this.count===this.left.length){this.port.postMessage({left:this.left,right:this.right,firstFrame:this.firstFrame});this.count++;return false;}return true;}}
            registerProcessor('shaper-capture',ShaperCapture);`;
        const url = URL.createObjectURL(new Blob([recorderCode], { type: 'text/javascript' }));
        await context.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const start = Math.ceil(((context.currentTime + 0.2) * rate) / 128) * 128;
        const buffer = context.createBuffer(2, frames, rate);
        const inLeft = buffer.getChannelData(0),
            inRight = buffer.getChannelData(1);
        for (let frame = 0; frame < frames; frame++) {
            inLeft[frame] = frame < 4096 ? 0.5 : -0.2;
            inRight[frame] = frame >= 211 && frame < 216 ? 0.7 : 0.001;
        }
        const capture = new AudioWorkletNode(context, 'shaper-capture', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { start, frames },
        });
        capture.parameters.get('capture')?.setValueAtTime(1, 0);
        const captured = new Promise<{ left: Float32Array; right: Float32Array; firstFrame: number }>((resolve) => {
            capture.port.onmessage = (event) => resolve(event.data);
        });
        const mute = context.createGain();
        mute.gain.value = 0;
        capture.connect(mute);
        mute.connect(context.destination);
        device.outputNode.connect(capture);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(strip.gainNode);
        const attack = [
            { frame: 0, value: 1 },
            { frame: 61, value: 1.5 },
            { frame: 257, value: 2 },
            { frame: 4097, value: 0.75 },
        ];
        const sustain = [
            { frame: 0, value: 1 },
            { frame: 129, value: 0.25 },
            { frame: 4097, value: 0.5 },
        ];
        for (const [name, points] of [
            ['attackGain', attack],
            ['sustainGain', sustain],
        ] as const)
            for (const point of points)
                audio.scheduleDeviceParam(trackId, deviceId, name, point.value, (start + point.frame) / rate);
        source.start(start / rate);
        const live = await captured;
        source.disconnect();
        capture.disconnect();
        capture.port.close();
        const offline = new OfflineAudioContext(2, frames, rate);
        const strategy = await createNativeDspStrategy(offline, {
            id: 'offline-shaper',
            name: 'Transient Shaper',
            type: 'transient-shaper',
            bypassed: false,
            parameterValues: { attackGain: 1, sustainGain: 1 },
        });
        for (const [name, points] of [
            ['attackGain', attack],
            ['sustainGain', sustain],
        ] as const)
            strategy.scheduleParam?.(
                name,
                points.map((point) => ({
                    startFrame: point.frame,
                    endFrame: point.frame,
                    startValue: point.value,
                    endValue: point.value,
                }))
            );
        const offlineSource = offline.createBufferSource();
        offlineSource.buffer = buffer;
        offlineSource.connect(strategy.node.inputNode);
        strategy.node.outputNode.connect(offline.destination);
        offlineSource.start();
        const printed = await offline.startRendering();
        strategy.destroy?.();
        const f = Math.fround;
        const coefficient = (seconds: number) => f(1 - f(Math.exp(f(-1 / f(f(seconds) * rate)))));
        const fast = coefficient(0.0005),
            slow = coefficient(0.02);
        let parityError = 0,
            oracleError = 0;
        const differences: Array<{ channel: number; frame: number; live: number; offline: number; expected: number }> =
            [];
        for (let channel = 0; channel < 2; channel++) {
            let fastEnv = 0,
                slowEnv = 0;
            const input = buffer.getChannelData(channel),
                rendered = channel === 0 ? live.left : live.right,
                offlineSamples = printed.getChannelData(channel);
            for (let frame = 0; frame < frames; frame++) {
                const sample = input[frame];
                fastEnv = f(fastEnv + f(fast * f(Math.abs(sample) - fastEnv)));
                slowEnv = f(slowEnv + f(slow * f(Math.abs(sample) - slowEnv)));
                if (Math.abs(fastEnv) < 1.1754943508222875e-38) fastEnv = 0;
                if (Math.abs(slowEnv) < 1.1754943508222875e-38) slowEnv = 0;
                const a = frame < 61 ? 1 : frame < 257 ? 1.5 : frame < 4097 ? 2 : 0.75;
                const b = frame < 129 ? 1 : frame < 4097 ? 0.25 : 0.5;
                const expected = f(sample * (f(fastEnv - slowEnv) > 0.01 ? a : b));
                if (Math.abs(rendered[frame] - offlineSamples[frame]) > 1e-7 && differences.length < 12) {
                    differences.push({
                        channel,
                        frame,
                        live: rendered[frame],
                        offline: offlineSamples[frame],
                        expected,
                    });
                }
                parityError = Math.max(parityError, Math.abs(rendered[frame] - offlineSamples[frame]));
                oracleError = Math.max(oracleError, Math.abs(rendered[frame] - expected));
            }
        }
        // Keep the real source feeding the actual TrackNode until its unity
        // followers are settled, then capture exactly the reset control quantum.
        audio.updateDeviceParam(trackId, deviceId, 'attackGain', 1);
        audio.updateDeviceParam(trackId, deviceId, 'sustainGain', 1);
        const constant = context.createConstantSource();
        constant.offset.value = 0.5;
        constant.connect(strip.gainNode);
        constant.start();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        device.outputNode.connect(analyser);
        const warmUntil = context.currentTime + 1;
        while (context.currentTime < warmUntil) await new Promise(requestAnimationFrame);
        // Chromium lands every AudioParam write made at a currentTime that sits
        // above its integer frame on the next sample (a k-rate one a quantum
        // late). Re-enter on such a frame, so the case proves the hard re-entry
        // every run instead of on the few pause frames that happen to hit it.
        // Such frames cluster with long gaps between, so each attempt lets the
        // clock run to just before the next one and suspends there.
        const sitsAbove = (frame: number) => (frame / rate) * rate > frame;
        const nextFrameAbove = (from: number) => {
            let frame = Math.ceil(from / 128) * 128;
            while (!sitsAbove(frame)) frame += 128;
            return frame;
        };
        const contextFrame = () => Math.round(context.currentTime * rate);
        await context.suspend();
        let reentryAttempts = 0;
        while (!sitsAbove(contextFrame())) {
            reentryAttempts++;
            if (reentryAttempts > 400) throw new Error('No suspended frame sat above its integer frame');
            const target = nextFrameAbove(contextFrame());
            await context.resume();
            while (contextFrame() < target - 512) await new Promise(requestAnimationFrame);
            await context.suspend();
        }
        const resumeFrame = contextFrame();
        const reentryCapture = new AudioWorkletNode(context, 'shaper-capture', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { start: 0, frames: 128 },
        });
        const reentry = new Promise<{ left: Float32Array; right: Float32Array; firstFrame: number }>((resolve) => {
            reentryCapture.port.onmessage = (event) => resolve(event.data);
        });
        strip.analyserNode.connect(reentryCapture);
        reentryCapture.connect(mute);
        reentryCapture.parameters.get('capture')?.setValueAtTime(1, context.currentTime);
        audio.updateDeviceBypass(trackId, deviceId, true);
        audio.updateDeviceParam(trackId, deviceId, 'attackGain', 2);
        audio.updateDeviceParam(trackId, deviceId, 'sustainGain', 0.25);
        audio.updateDeviceBypass(trackId, deviceId, false);
        await context.resume();
        const fresh = await reentry;
        constant.stop();
        constant.disconnect();
        reentryCapture.disconnect();
        reentryCapture.port.close();
        analyser.disconnect();
        mute.disconnect();
        return {
            frames,
            rate,
            parityError,
            oracleError,
            differences,
            captureStart: start,
            firstCapturedFrame: live.firstFrame,
            reentry: [fresh.left[0] / strip.faderNode.gain.value, fresh.right[0] / strip.faderNode.gain.value],
            resumeFrame,
            reentryAttempts,
            reentryFirstFrame: fresh.firstFrame,
            actualReady: device.controller.ready,
            pendingFinalBypassed,
        };
    });
    await testInfo.attach('actual-live-offline-oracle', {
        body: JSON.stringify(result),
        contentType: 'application/json',
    });
    expect(result.firstCapturedFrame).toBe(result.captureStart);
    expect(result.parityError).toBeLessThan(1e-7);
    expect(result.oracleError).toBeLessThan(1e-7);
    expect(result.reentryFirstFrame).toBe(result.resumeFrame);
    expect(result.reentry).toEqual([1, 1]);
    expect(result.actualReady).toBe(true);
    expect(result.pendingFinalBypassed).toBe(true);
});

test('integer frame origins do not move scheduled steps one sample late', async ({ page }, testInfo) => {
    await probePage(page);
    const results = await page.evaluate(async () => {
        const { createTransientShaperNode } = await import('/src/modules/AudioEngine/engine/TransientShaperNode.ts');
        const results = [];
        for (const origin of [0, 384, 512, 1408, 2176, 3072]) {
            const context = new OfflineAudioContext(2, origin + 8192, 48000);
            const node = await createTransientShaperNode(context);
            await node.ready;
            const source = context.createConstantSource();
            source.offset.value = 0.5;
            source.connect(node.workletNode);
            node.workletNode.connect(context.destination);
            node.setParam('attackGain', 1.5, origin + 61);
            node.setParam('attackGain', 2, origin + 257);
            source.start(origin / 48000);
            const audio = await context.startRendering();
            const left = audio.getChannelData(0);
            results.push({
                origin,
                timeProduct: ((origin + 257) / 48000) * 48000,
                at60: left[origin + 60],
                at61: left[origin + 61],
                at256: left[origin + 256],
                at257: left[origin + 257],
                at258: left[origin + 258],
            });
            node.destroy();
        }
        return results;
    });
    await testInfo.attach('frame-origin-diagnostic', {
        body: JSON.stringify(results),
        contentType: 'application/json',
    });
    for (const result of results) {
        expect(result.at60).toBe(0.5);
        expect(result.at61).toBe(0.75);
        expect(result.at256).toBe(0.75);
        expect(result.at257).toBe(1);
        expect(result.at258).toBe(1);
    }
});

test('reset epoch is consumed before re-entry at suspended frame896', async ({ page }, testInfo) => {
    await probePage(page);
    const result = await page.evaluate(async () => {
        const { createTransientShaperNode } = await import('/src/modules/AudioEngine/engine/TransientShaperNode.ts');
        const context = new OfflineAudioContext(2, 8192, 48000);
        const node = await createTransientShaperNode(context);
        await node.ready;
        node.setParam('attackGain', 2, 0);
        node.setParam('sustainGain', 0.25, 0);
        const source = context.createBufferSource(),
            buffer = context.createBuffer(2, 8192, 48000);
        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            data.fill(0.5, 0, 128);
            data.fill(0.5, 896);
        }
        source.buffer = buffer;
        source.connect(node.workletNode);
        node.workletNode.connect(context.destination);
        const suspended = context.suspend(896 / 48000);
        source.start();
        const pending = context.startRendering();
        await suspended;
        const suspendedTime = context.currentTime,
            suspendedFrame = Math.round(suspendedTime * context.sampleRate);
        node.setBypass(true);
        node.setBypass(false);
        await context.resume();
        const audio = await pending;
        const left = audio.getChannelData(0);
        node.destroy();
        const freshContext = new OfflineAudioContext(2, 8192, 48000);
        const freshNode = await createTransientShaperNode(freshContext);
        await freshNode.ready;
        freshNode.setParam('attackGain', 2, 0);
        freshNode.setParam('sustainGain', 0.25, 0);
        const freshSource = freshContext.createBufferSource(),
            freshBuffer = freshContext.createBuffer(2, 8192, 48000);
        freshBuffer.getChannelData(0).fill(0.5, 896);
        freshBuffer.getChannelData(1).fill(0.5, 896);
        freshSource.buffer = freshBuffer;
        freshSource.connect(freshNode.workletNode);
        freshNode.workletNode.connect(freshContext.destination);
        freshSource.start();
        const expected = (await freshContext.startRendering()).getChannelData(0);
        let resetOracleError = 0;
        const differences = [];
        for (let frame = 896; frame < 8192; frame++) {
            resetOracleError = Math.max(resetOracleError, Math.abs(left[frame] - expected[frame]));
            if (left[frame] !== expected[frame] && differences.length < 8)
                differences.push({ frame, actual: left[frame], expected: expected[frame] });
        }
        freshNode.destroy();
        return {
            resetOracleError,
            differences,
            suspendedTime,
            suspendedFrame,
            timeProduct: suspendedTime * 48000,
            first: left[896],
            next: left[897],
        };
    });
    await testInfo.attach('reset896-diagnostic', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.suspendedFrame).toBe(896);
    expect(result.resetOracleError).toBe(0);
    expect(result.first).toBe(1);
    expect(result.next).toBe(1);
});

test('real worklet export failure and terminal reset exhaustion cannot report successful processing', async ({
    page,
}, testInfo) => {
    await probePage(page);
    const result = await page.evaluate(async () => {
        const { createTransientShaperNode } = await import('/src/modules/AudioEngine/engine/TransientShaperNode.ts');
        const { createNativeDspStrategy } =
            await import('/src/modules/AudioEngine/repositories/deviceStrategy/NativeDspDeviceStrategy.ts');
        const Original = AudioWorkletNode;
        const minimal = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
        let exportFailure: string | null = null;
        try {
            window.AudioWorkletNode = class extends Original {
                constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
                    super(
                        context,
                        name,
                        name === 'transient-shaper-processor'
                            ? { ...options, processorOptions: { wasmModule: minimal } }
                            : options
                    );
                }
            };
            try {
                await createNativeDspStrategy(new OfflineAudioContext(2, 128, 48000), {
                    id: 'failed-export',
                    name: 'Transient Shaper',
                    type: 'transient-shaper',
                    bypassed: false,
                    parameterValues: { attackGain: 2, sustainGain: 0.25 },
                });
            } catch (error) {
                exportFailure = String(error);
            }
        } finally {
            window.AudioWorkletNode = Original;
        }
        const context = new OfflineAudioContext(2, 128, 48000);
        let runtimeFailure: string | null = null;
        try {
            // Boundary fixture primes the real host-private AudioParam before
            // the node captures its initial exact counter; no readiness is forged.
            window.AudioWorkletNode = class extends Original {
                constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
                    super(context, name, options);
                    if (name === 'transient-shaper-processor') {
                        const epoch = this.parameters.get('_resetEpoch');
                        if (!epoch) throw new Error('Missing private reset parameter');
                        epoch.value = 16777214;
                    }
                }
            };
            const node = await createTransientShaperNode(context, undefined, (message) => {
                runtimeFailure = message;
            });
            await node.ready;
            const source = context.createConstantSource();
            source.offset.value = 0.5;
            source.connect(node.workletNode);
            node.workletNode.connect(context.destination);
            source.start();
            node.setBypass(true);
            node.setBypass(false);
            const buffer = await context.startRendering();
            let energy = 0;
            for (let channel = 0; channel < 2; channel++)
                for (const sample of buffer.getChannelData(channel)) energy += sample * sample;
            node.destroy();
            return { exportFailure, runtimeFailure, energy, successfulProcessing: energy > 0 };
        } finally {
            window.AudioWorkletNode = Original;
        }
    });
    expect(result.exportFailure).toBeTruthy();
    expect(result.runtimeFailure).toContain('epoch exhausted');
    expect(result.energy).toBe(0);
    expect(result.successfulProcessing).toBe(false);
    await testInfo.attach('actual-failed-runtime-phases', {
        body: JSON.stringify(result),
        contentType: 'application/json',
    });
});

test('bounded live Chromium trace observes the active scalar bridge and dry workload', async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await probePage(page);
    const session = await page.context().newCDPSession(page);
    const version = await session.send('Browser.getVersion');
    const completion = new Promise<{ stream?: string; dataLossOccurred?: boolean }>((resolve) =>
        session.once('Tracing.tracingComplete', resolve)
    );
    await session.send('Tracing.start', {
        transferMode: 'ReturnAsStream',
        streamFormat: 'json',
        streamCompression: 'gzip',
        traceConfig: {
            recordMode: 'recordUntilFull',
            traceBufferSizeInKb: 16384,
            enableSampling: false,
            enableSystrace: false,
            includedCategories: [
                'disabled-by-default-audio-worklet',
                'disabled-by-default-webaudio.audionode',
                'audio',
                'webaudio',
                'blink.user_timing',
            ],
        },
    });
    let observation: unknown;
    try {
        observation = await page.evaluate(async () => {
            const { createTransientShaperNode } =
                await import('/src/modules/AudioEngine/engine/TransientShaperNode.ts');
            const context = new AudioContext({ sampleRate: 48000 });
            await context.resume();
            const source = context.createConstantSource();
            source.offset.value = 0.5;
            const analyser = context.createAnalyser();
            analyser.fftSize = 256;
            const mute = context.createGain();
            mute.gain.value = 0;
            analyser.connect(mute);
            mute.connect(context.destination);
            source.connect(analyser);
            source.start();
            const samples = new Float32Array(256);
            async function observe(expected: number, name: string) {
                const deadline = performance.now() + 5000;
                while (true) {
                    analyser.getFloatTimeDomainData(samples);
                    if (samples.every((sample) => Math.abs(sample - expected) < 0.00001)) break;
                    if (performance.now() > deadline) throw new Error(`${name} never rendered expected audio`);
                    await new Promise(requestAnimationFrame);
                }
                performance.mark(`${name}-start`);
                const start = context.currentTime;
                while (context.currentTime - start < 0.25) await new Promise(requestAnimationFrame);
                performance.mark(`${name}-end`);
                analyser.getFloatTimeDomainData(samples);
                return { first: samples[0], last: samples[255], audioSeconds: context.currentTime - start };
            }
            const dry = await observe(0.5, 'transient-dry');
            let failed: string | null = null;
            const creating = createTransientShaperNode(context, undefined, (message) => {
                failed = message;
            });
            const node = await creating;
            let moduleReady = false;
            void node.ready.then(() => {
                moduleReady = true;
            });
            const pending = moduleReady;
            await node.ready;
            node.setParam('attackGain', 0.5);
            node.setParam('sustainGain', 0.5);
            source.disconnect();
            source.connect(node.workletNode);
            node.workletNode.connect(analyser);
            const active = await observe(0.25, 'transient-active');
            node.destroy();
            source.stop();
            await context.close();
            return {
                sampleRate: context.sampleRate,
                pending,
                activeAudioObserved: Math.abs((active.first ?? 0) - 0.25) < 0.00001,
                dry,
                active,
                failed,
                coverage:
                    'Observed Chromium author/outer/destination intervals only; driver continuity and host deadlines unavailable.',
            };
        });
    } finally {
        await session.send('Tracing.end');
    }
    const completed = await completion;
    expect(completed.dataLossOccurred).not.toBe(true);
    if (!completed.stream) throw new Error('Trace stream is unavailable');
    const chunks: Buffer[] = [];
    let size = 0;
    let eof = false;
    try {
        while (!eof) {
            const read = await session.send('IO.read', { handle: completed.stream, size: 1024 * 1024 });
            const bytes = Buffer.from(read.data, read.base64Encoded ? 'base64' : 'utf8');
            size += bytes.length;
            if (size > 16 * 1024 * 1024) throw new Error('Bounded trace exceeded 16MiB');
            chunks.push(bytes);
            eof = read.eof === true;
        }
    } finally {
        await session.send('IO.close', { handle: completed.stream });
        await session.detach();
    }
    expect(eof).toBe(true);
    const captureId = Date.now();
    const compressed = Buffer.concat(chunks);
    const tracePath = testInfo.outputPath(`transient-shaper-live-trace-${captureId}.json.gz`);
    await writeFile(tracePath, compressed);
    await testInfo.attach('live-effect-trace-raw', { path: tracePath, contentType: 'application/gzip' });
    const decoded = gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 });
    const trace: unknown = JSON.parse(decoded.toString('utf8'));
    if (!record(trace) || !Array.isArray(trace.traceEvents)) throw new Error('Trace events absent');
    const events = trace.traceEvents.filter(record);
    const start = events.find((event) => event.name === 'transient-active-start');
    const end = events.find((event) => event.name === 'transient-active-end');
    if (typeof start?.ts !== 'number' || typeof end?.ts !== 'number') throw new Error('Active trace bounds absent');
    const startTs = start.ts,
        endTs = end.ts;
    const relevant = events.filter((event) => typeof event.ts === 'number' && event.ts >= startTs && event.ts < endTs);
    const author = relevant.filter(
        (event) => event.name === 'AudioWorkletProcessor::Process (author script execution)' && event.ph === 'X'
    );
    const outer = relevant.filter((event) => event.name === 'AudioWorkletProcessor::Process' && event.ph === 'X');
    const destination = relevant.filter(
        (event) => event.name === 'RealtimeAudioDestinationHandler::Render' && event.ph === 'X'
    );
    const dryStart = events.find((event) => event.name === 'transient-dry-start');
    const dryEnd = events.find((event) => event.name === 'transient-dry-end');
    if (
        typeof dryStart?.ts !== 'number' ||
        typeof dryEnd?.ts !== 'number' ||
        !record(observation) ||
        typeof observation.sampleRate !== 'number'
    )
        throw new Error('Dry bounds or actual sample rate missing');
    const dryStartTs = dryStart.ts,
        dryEndTs = dryEnd.ts,
        rate = observation.sampleRate;
    const dryDestination = events.filter(
        (event) =>
            event.name === 'RealtimeAudioDestinationHandler::Render' &&
            event.ph === 'X' &&
            typeof event.ts === 'number' &&
            event.ts >= dryStartTs &&
            event.ts < dryEndTs
    );
    expect(author.length).toBeGreaterThan(0);
    expect(outer.length).toBe(author.length);
    expect(destination.length).toBeGreaterThan(0);
    expect(dryDestination.length).toBeGreaterThan(0);
    function interval(value: Record<string, unknown>) {
        if (typeof value.ts !== 'number' || typeof value.dur !== 'number' || value.dur < 0)
            throw new Error('Incomplete trace interval');
        return { start: value.ts, end: value.ts + value.dur, duration: value.dur };
    }
    for (const authorEvent of author) {
        const own = interval(authorEvent);
        const parents = outer.filter(
            (event) =>
                event.pid === authorEvent.pid &&
                event.tid === authorEvent.tid &&
                interval(event).start <= own.start &&
                interval(event).end >= own.end
        );
        expect(parents).toHaveLength(1);
    }
    const budgets = destination.map((event) => {
        if (!record(event.args) || typeof event.args.frames !== 'number' || event.args.frames <= 0)
            throw new Error('Destination frame producer missing');
        const span = interval(event),
            budgetUs = (event.args.frames / rate) * 1e6;
        const children = author.filter(
            (child) =>
                child.pid === event.pid &&
                child.tid === event.tid &&
                interval(child).start >= span.start &&
                interval(child).end <= span.end
        );
        expect(children.length).toBeGreaterThan(0);
        expect(span.duration).toBeLessThan(budgetUs);
        return {
            frames: event.args.frames,
            budgetUs,
            durationUs: span.duration,
            authorCallbacks: children.length,
            authorDurationUs: children.reduce((sum, child) => sum + interval(child).duration, 0),
        };
    });
    const durations = (items: Record<string, unknown>[]) =>
        items.map((item) => interval(item).duration).sort((a, b) => a - b);
    const summarize = (values: number[]) => ({
        count: values.length,
        medianUs: values[Math.floor(values.length / 2)],
        p95Us: values[Math.floor(values.length * 0.95)],
        maximumUs: values.at(-1),
    });
    const receipt = {
        observation,
        version,
        dataLossOccurred: completed.dataLossOccurred ?? false,
        authorCallbacks: author.length,
        outerCallbacks: outer.length,
        destinationCallbacks: destination.length,
        dryDestination: summarize(durations(dryDestination)),
        activeDestination: summarize(durations(destination)),
        budgets,
        author,
        outer,
        destination,
    };
    const receiptPath = testInfo.outputPath(`transient-shaper-live-trace-receipt-${captureId}.json`);
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
    await testInfo.attach('live-effect-trace-receipt', {
        path: receiptPath,
        contentType: 'application/json',
    });
});

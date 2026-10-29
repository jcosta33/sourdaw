import { expect, test } from '@playwright/test';

import { admitLoopbackProvider } from './admitLoopbackProvider';
import { launch_new_project, setupWorkspace } from './e2eUtils';
import { startScriptedToolProvider, type ScriptedToolRequest } from './scriptedToolProvider';

function tool(request: ScriptedToolRequest, name: string): string {
    const wire = name.replaceAll('.', '_');
    const found = request.tools.find((entry) => entry.function.name === wire);
    if (!found) throw new Error(`Application did not offer ${name}`);
    return found.function.name;
}

function receipt(request: ScriptedToolRequest, id: string): Record<string, unknown> {
    const item = request.messages.find((message) => message.role === 'tool' && message.tool_call_id === id);
    if (typeof item?.content !== 'string') throw new Error(`Missing receipt ${id}`);
    const value: unknown = JSON.parse(item.content);
    if (
        !value ||
        typeof value !== 'object' ||
        !('status' in value) ||
        value.status !== 'success' ||
        !('data' in value) ||
        !value.data ||
        typeof value.data !== 'object'
    ) {
        throw new Error(`Failed receipt ${id}: ${item.content}`);
    }
    return value.data as Record<string, unknown>;
}

const compressorRecipes = [
    { id: 'vocal-controlled', role: 'vocal' },
    { id: 'bass-controlled', role: 'bass' },
    { id: 'guitar-controlled', role: 'guitar' },
    { id: 'keys-controlled', role: 'keys' },
    { id: 'bus-controlled', role: 'bus' },
    { id: 'master-controlled', role: 'master' },
] as const;

test('every controlled compressor expansion lowers measured dynamic range through the shipping device', async ({
    page,
}, testInfo) => {
    test.setTimeout(180_000);
    await setupWorkspace(page);
    await launch_new_project(page);

    const readings = await page.evaluate(async (cases) => {
        const [
            { executeAppAction },
            { getProjectContext },
            { expandMixRecipe },
            { createWebAudioDevice },
            { measureAgentObjectiveBuffer },
        ] = await Promise.all([
            import('/src/modules/Command/useCases/index.ts'),
            import('/src/modules/AiRuntime/useCases/getProjectContext.ts'),
            import('/src/modules/AiRuntime/useCases/expandMixRecipe.ts'),
            import('/src/modules/AudioEngine/repositories/deviceStrategy/WebAudioDeviceStrategy.ts'),
            import('/src/modules/AudioAnalysis/useCases/measureAgentObjectiveBuffer.ts'),
        ]);
        const sampleRate = 48_000;
        const frameCount = sampleRate * 8;
        const trackId = crypto.randomUUID();
        await executeAppAction({
            type: 'addTrack',
            payload: { id: trackId, name: 'Controlled witness', kind: 'audio' },
        });
        const context = getProjectContext();
        const results = [];

        for (const [ordinal, entry] of cases.entries()) {
            const expansion = expandMixRecipe(
                { recipeId: entry.id, targetId: trackId, role: entry.role, values: [] },
                context,
                ordinal + 1
            );
            if (expansion.status !== 'expanded') throw new Error(`${entry.id}: ${expansion.reason}`);
            if (
                expansion.commands[0]?.operation !== 'addDevice' ||
                expansion.commands[0].arguments.deviceType !== 'builtin-compressor'
            ) {
                throw new Error(`${entry.id}: not an ordinary compressor insertion`);
            }
            const parameters: Record<string, number> = {};
            for (const item of expansion.commands.slice(1)) {
                if (
                    item.operation !== 'setDeviceParameter' ||
                    typeof item.arguments.paramId !== 'string' ||
                    typeof item.arguments.value !== 'number'
                ) {
                    throw new Error(`${entry.id}: not an ordinary parameter command`);
                }
                parameters[item.arguments.paramId] = item.arguments.value;
            }
            if (expansion.values.some((value) => value.source !== 'midpoint'))
                throw new Error(`${entry.id}: midpoint provenance lost`);

            const dry = new AudioBuffer({ length: frameCount, numberOfChannels: 1, sampleRate });
            const samples = dry.getChannelData(0);
            for (let frame = 0; frame < frameCount; frame++) {
                const plateau = Math.floor(frame / sampleRate) % 2 === 0 ? 0.65 : 0.025;
                samples[frame] = plateau * Math.sin((2 * Math.PI * 220 * frame) / sampleRate);
            }
            const sourceHash = Array.from(
                new Uint8Array(await crypto.subtle.digest('SHA-256', samples.slice().buffer))
            ).join(',');
            const offline = new OfflineAudioContext(1, frameCount, sampleRate);
            const device = createWebAudioDevice(offline, {
                id: `controlled-${entry.role}`,
                name: 'Compressor',
                type: 'builtin-compressor',
                bypassed: false,
                parameterValues: parameters,
            });
            const source = offline.createBufferSource();
            source.buffer = dry;
            source.connect(device.node.inputNode);
            device.node.outputNode.connect(offline.destination);
            source.start();
            const wet = await offline.startRendering();
            const renderedSourceHash = Array.from(
                new Uint8Array(await crypto.subtle.digest('SHA-256', samples.slice().buffer))
            ).join(',');
            const dryMetric = measureAgentObjectiveBuffer(dry).measurements.dynamicRangeEstimate;
            const wetMetric = measureAgentObjectiveBuffer(wet).measurements.dynamicRangeEstimate;
            if (
                dryMetric.status !== 'measured' ||
                wetMetric.status !== 'measured' ||
                typeof dryMetric.value !== 'number' ||
                typeof wetMetric.value !== 'number'
            ) {
                throw new Error(`${entry.id}: actual dynamic range was unavailable`);
            }
            let wetEnergy = 0;
            for (const sample of wet.getChannelData(0)) {
                if (!Number.isFinite(sample)) throw new Error(`${entry.id}: nonfinite audio`);
                wetEnergy += sample * sample;
            }
            results.push({
                id: entry.id,
                role: entry.role,
                parameters,
                commands: expansion.commands.map((item) => item.operation),
                dry: dryMetric.value,
                wet: wetMetric.value,
                wetEnergy,
                sourceUnchanged: sourceHash === renderedSourceHash,
            });
        }
        return results;
    }, compressorRecipes);

    console.log('controlled compressor readings', JSON.stringify(readings));
    expect(readings.map((entry) => entry.id)).toEqual(compressorRecipes.map((entry) => entry.id));
    for (const entry of readings) {
        expect(entry.commands[0]).toBe('addDevice');
        expect(entry.commands.slice(1).every((command) => command === 'setDeviceParameter')).toBe(true);
        expect(Number.isFinite(entry.dry)).toBe(true);
        expect(Number.isFinite(entry.wet)).toBe(true);
        expect(entry.dry).toBeGreaterThan(10);
        expect(entry.dry - entry.wet).toBeGreaterThan(1);
        expect(entry.wetEnergy).toBeGreaterThan(0);
        expect(entry.sourceUnchanged).toBe(true);
    }
    await testInfo.attach('actual-controlled-compressor-measurements', {
        body: JSON.stringify(readings),
        contentType: 'application/json',
    });
});

test('controlled drum gate reaches public proposal, linked stereo sound, Undo/Redo and durable reopen', async ({
    page,
}, testInfo) => {
    test.setTimeout(180_000);
    await setupWorkspace(page);
    await launch_new_project(page);
    const trackId = await page.evaluate(async () => {
        const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
        const { cacheAudioBuffer } = await import('/src/modules/AudioEngine/useCases/index.ts');
        const trackId = crypto.randomUUID();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 120 } });
        await executeAppAction({ type: 'addTrack', payload: { id: trackId, name: 'Close Drums', kind: 'audio' } });
        await executeAppAction({
            type: 'addTrack',
            payload: { id: crypto.randomUUID(), name: 'Untouched Guitar', kind: 'audio' },
        });
        const buffer = new AudioBuffer({ length: 48_000, numberOfChannels: 2, sampleRate: 48_000 });
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);
        for (let frame = 0; frame < buffer.length; frame++) {
            const seconds = frame / buffer.sampleRate;
            const open = (seconds >= 0.1 && seconds < 0.25) || (seconds >= 0.55 && seconds < 0.7);
            const wave = Math.sin((2 * Math.PI * 220 * frame) / buffer.sampleRate);
            left[frame] = 0.005 * wave;
            right[frame] = (open ? 0.035 : 0.005) * wave;
        }
        const audioBufferId = cacheAudioBuffer({ buffer });
        await executeAppAction({
            type: 'addClip',
            payload: {
                trackId,
                name: 'Asymmetric close drums',
                startBeat: 0,
                endBeat: 2,
                type: 'audio',
                audioBufferId,
            },
        });
        return trackId;
    });

    async function state() {
        return page.evaluate(async () => {
            const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
            const { audioBufferCache } = await import('/src/modules/AudioEngine/stores/index.ts');
            const { undoHistoryStore } = await import('/src/modules/Command/stores/index.ts');
            const { getCrdtDoc, captureProjectRevision, settlePendingProjectWritesAndCaptureRevision } =
                await import('/src/modules/CrdtDocument/useCases/index.ts');
            settlePendingProjectWritesAndCaptureRevision();
            const tracks = trackStore.value?.tracks ?? [];
            const sourceId = tracks.find((track) => track.name === 'Close Drums')?.clips[0]?.audioBufferId;
            const source = sourceId ? audioBufferCache.get(sourceId) : undefined;
            if (!source) throw new Error('Actual source PCM unavailable');
            const hashes = [];
            for (let channel = 0; channel < source.numberOfChannels; channel++) {
                hashes.push(
                    Array.from(
                        new Uint8Array(
                            await crypto.subtle.digest('SHA-256', source.getChannelData(channel).slice().buffer)
                        )
                    ).join(',')
                );
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

    async function render() {
        return page.evaluate(async () => {
            const { renderOffline } = await import('/src/modules/AudioEngine/useCases/index.ts');
            const { measureAgentObjectiveBuffer } =
                await import('/src/modules/AudioAnalysis/useCases/measureAgentObjectiveBuffer.ts');
            const warnings: string[] = [];
            const audio = await renderOffline({
                durationBeats: 2,
                sampleRate: 48_000,
                tailSeconds: 0,
                onWarning: (message: string) => warnings.push(message),
            });
            const metric = measureAgentObjectiveBuffer(audio).measurements.rms;
            if (metric.status !== 'measured' || typeof metric.value !== 'number')
                throw new Error('Gate RMS unavailable');
            const hashes = [];
            const windows = { sustainedLeft: 0, sustainedRight: 0, gapLeft: 0, gapRight: 0, preSecondGapLeft: 0 };
            for (let channel = 0; channel < audio.numberOfChannels; channel++) {
                const data = audio.getChannelData(channel);
                hashes.push(
                    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data.slice().buffer))).join(',')
                );
                let openEnergy = 0,
                    gapEnergy = 0,
                    preSecondGapEnergy = 0;
                for (let frame = 0; frame < data.length; frame++) {
                    const sample = data[frame];
                    if (!Number.isFinite(sample)) throw new Error('Nonfinite gate output');
                    if (frame >= 7_200 && frame < 10_800) openEnergy += sample * sample;
                    if (frame >= 20_000 && frame < 24_000) gapEnergy += sample * sample;
                    if (frame >= 25_000 && frame < 26_000) preSecondGapEnergy += sample * sample;
                }
                if (channel === 0) {
                    windows.sustainedLeft = openEnergy;
                    windows.gapLeft = gapEnergy;
                    windows.preSecondGapLeft = preSecondGapEnergy;
                }
                if (channel === 1) {
                    windows.sustainedRight = openEnergy;
                    windows.gapRight = gapEnergy;
                }
            }
            return { hashes, windows, rms: metric.value, warnings };
        });
    }

    const before = await state();
    const dry = await render();
    const provider = await startScriptedToolProvider((request, turn) => {
        expect(turn).toBeLessThan(4);
        if (turn === 0)
            return [
                {
                    id: 'project',
                    name: tool(request, 'project.query'),
                    arguments: { type: 'object', page: { limit: 50 } },
                },
            ];
        if (turn === 1) {
            receipt(request, 'project');
            return [
                {
                    id: 'discover',
                    name: tool(request, 'recipe.discover'),
                    arguments: { descriptors: ['controlled'], targetId: trackId, role: 'drums', limit: 8 },
                },
            ];
        }
        if (turn === 2) {
            const discovered = receipt(request, 'discover');
            expect(discovered.candidates).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: 'drums-controlled-gate',
                        steps: [expect.objectContaining({ deviceType: 'faust-noise-gate' })],
                    }),
                ])
            );
            return [
                {
                    id: 'expand',
                    name: tool(request, 'recipe.expand'),
                    arguments: { recipeId: 'drums-controlled-gate', targetId: trackId, role: 'drums' },
                },
            ];
        }
        const expanded = receipt(request, 'expand');
        expect(expanded.recipeId).toBe('drums-controlled-gate');
        expect(expanded.values).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ paramId: 'threshold', value: -42.5, source: 'midpoint' }),
                expect.objectContaining({ paramId: 'attack', value: 0.0051, source: 'midpoint' }),
                expect.objectContaining({ paramId: 'hold', value: 0.06, source: 'midpoint' }),
                expect.objectContaining({ paramId: 'release', value: 0.15, source: 'midpoint' }),
            ])
        );
        return [
            {
                id: 'proposal',
                name: tool(request, 'command.batch.propose'),
                arguments: {
                    commands: [],
                    compiledCallIds: ['expand'],
                    plan: {
                        semantic: { classification: 'complex', uncertainty: [] },
                        objective: 'Control Close Drums bleed with the Noise Gate recipe.',
                        constraints: [],
                        scope: { targetIds: [trackId], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                        capabilityIds: ['addDevice', 'setDeviceParameter'],
                        assetIds: [],
                        alternatives: [],
                        validationStrategy: ['Compare actual rendered stereo audio and retain source PCM.'],
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
        await composer.fill(
            'Add Noise Gate to Close Drums using the controlled recipe. Set its threshold to -42.5 dB. Set its attack to 0.0051 seconds. Set its hold to 0.06 seconds. Set its release to 0.15 seconds. Prepare it for confirmation.'
        );
        await composer.press('Enter');
        const confirm = page.getByRole('button', { name: 'Confirm pending actions', exact: true });
        await expect(confirm).toBeVisible({ timeout: 45_000 });
        expect(provider.failures).toEqual([]);
        const proposed = await state();
        expect(proposed.document).toBe(before.document);
        expect(proposed.revision).toBe(before.revision);
        expect(proposed.history).toBe(before.history);
        expect(proposed.hashes).toEqual(before.hashes);
        await confirm.click();
        await expect
            .poll(async () => (await state()).tracks.find((track) => track.name === 'Close Drums')?.devices.length)
            .toBe(1);
        const committed = await state();
        const gate = committed.tracks.find((track) => track.name === 'Close Drums')?.devices[0];
        expect(gate?.type).toBe('faust-noise-gate');
        expect(gate?.parameterValues).toMatchObject({ threshold: -42.5, attack: 0.0051, hold: 0.06, release: 0.15 });
        expect(committed.tracks.find((track) => track.name === 'Untouched Guitar')).toEqual(
            before.tracks.find((track) => track.name === 'Untouched Guitar')
        );
        expect(committed.hashes).toEqual(before.hashes);
        const wet = await render();
        expect(wet.hashes).not.toEqual(dry.hashes);
        expect(wet.rms).toBeLessThan(dry.rms);
        expect(wet.windows.sustainedLeft).toBeGreaterThan(dry.windows.sustainedLeft * 0.5);
        expect(wet.windows.gapLeft).toBeLessThan(dry.windows.gapLeft * 0.5);
        await page.getByTestId('transport-undo').click();
        await expect
            .poll(async () => (await state()).tracks.find((track) => track.name === 'Close Drums')?.devices.length)
            .toBe(0);
        expect((await render()).hashes).toEqual(dry.hashes);
        await page.getByTestId('transport-redo').click();
        await expect
            .poll(async () => (await state()).tracks.find((track) => track.name === 'Close Drums')?.devices.length)
            .toBe(1);
        expect((await render()).hashes).toEqual(wet.hashes);
        const persistence = await page.evaluate(async () => {
            const { saveProject, loadRecentProject, getProjectSnapshotKey } =
                await import('/src/modules/Project/useCases/index.ts');
            const { projectStore } = await import('/src/modules/Project/stores/index.ts');
            const createdAt = projectStore.value?.createdAt;
            if (createdAt === undefined) throw new Error('No project identity to reopen');
            const saved = await saveProject();
            const loaded = saved
                ? await loadRecentProject(getProjectSnapshotKey(createdAt), { requireDurable: true })
                : 'not-attempted';
            return { saved, loaded };
        });
        expect(persistence).toEqual({ saved: true, loaded: 'committed' });
        const restored = await state();
        expect(restored.tracks.find((track) => track.name === 'Close Drums')?.devices).toEqual(
            committed.tracks.find((track) => track.name === 'Close Drums')?.devices
        );
        expect(restored.hashes).toEqual(before.hashes);
        expect((await render()).hashes).toEqual(wet.hashes);
        const controlAlternatives = [
            { paramId: 'threshold', value: -55 },
            { paramId: 'attack', value: 0.0002 },
            { paramId: 'hold', value: 0.02 },
            { paramId: 'release', value: 0.05 },
        ] as const;
        const controlWitnesses = [];
        for (const alternative of controlAlternatives) {
            await page.evaluate(
                async ({ deviceId, paramId, value }) => {
                    const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
                    await executeAppAction({ type: 'setDeviceParameter', payload: { deviceId, paramId, value } });
                },
                { deviceId: gate!.id, ...alternative }
            );
            const changed = await render();
            expect(changed.hashes, `${alternative.paramId} must affect actual sound`).not.toEqual(wet.hashes);
            controlWitnesses.push({ ...alternative, hashes: changed.hashes, rms: changed.rms });
            await page.evaluate(
                async ({ deviceId, paramId, value }) => {
                    const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
                    await executeAppAction({ type: 'setDeviceParameter', payload: { deviceId, paramId, value } });
                },
                { deviceId: gate!.id, paramId: alternative.paramId, value: gate!.parameterValues[alternative.paramId]! }
            );
            expect((await render()).hashes).toEqual(wet.hashes);
        }
        const automationLane = await page.evaluate(
            async ({ trackId, deviceId }) => {
                const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
                const { automationStore } = await import('/src/modules/Automation/stores/index.ts');
                const parameterId = `${deviceId}:threshold`;
                await executeAppAction({
                    type: 'addAutomationLane',
                    payload: { trackId, parameterId, parameterName: 'Gate threshold' },
                });
                const lane = automationStore.value?.lanes.find(
                    (entry) => entry.trackId === trackId && entry.parameterId === parameterId
                );
                if (!lane) throw new Error('Gate threshold automation lane unavailable');
                for (const [beat, value] of [
                    [0, -42.5],
                    [1, -55],
                ]) {
                    await executeAppAction({
                        type: 'addAutomationPoint',
                        payload: { laneId: lane.id, beat, value, curve: 'step', tension: 0 },
                    });
                }
                return lane.id;
            },
            { trackId, deviceId: gate!.id }
        );
        const automated = await render();
        expect(automated.hashes).not.toEqual(wet.hashes);
        expect(automated.windows.preSecondGapLeft).toBeGreaterThan(wet.windows.preSecondGapLeft * 2);
        await testInfo.attach('controlled-gate-public-receipt-and-audio', {
            body: JSON.stringify({
                dry,
                wet,
                persistence,
                sourceHashes: before.hashes,
                controlWitnesses,
                automationLane,
                automated,
            }),
            contentType: 'application/json',
        });
    } finally {
        await testInfo.attach('controlled-gate-scripted-provider', {
            body: JSON.stringify({ requests: provider.requests, failures: provider.failures }),
            contentType: 'application/json',
        });
        await provider.close();
    }
});

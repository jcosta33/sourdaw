import { expect, test, type Page } from '@playwright/test';

import { admitLoopbackProvider } from './admitLoopbackProvider';
import { launch_new_project, setupWorkspace } from './e2eUtils';
import { startScriptedToolProvider, type ScriptedToolRequest } from './scriptedToolProvider';

const READ = 'analysis.detectTransients';

/** Eighty separated attacks produce more than one 64-hit page through the real source Worker. */
function onsetWav(): Buffer {
    const rate = 44_100;
    const frames = rate * 13;
    const wav = Buffer.alloc(44 + frames * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + frames * 2, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(frames * 2, 40);
    for (let attack = 0; attack < 80; attack++) {
        const start = Math.floor(rate * (0.25 + attack * 0.15));
        for (let frame = 0; frame < Math.floor(rate * 0.02); frame++) {
            const sample = Math.sin((2 * Math.PI * 1_000 * frame) / rate) * Math.exp(-frame / (rate * 0.003));
            wav.writeInt16LE(Math.round(sample * 14_000), 44 + (start + frame) * 2);
        }
    }
    return wav;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toolWith(request: ScriptedToolRequest, properties: string[]): string {
    const tools = request.tools.filter((tool) =>
        properties.every((property) => property in tool.function.parameters.properties)
    );
    expect(tools, `one required tool with ${properties.join(', ')}`).toHaveLength(1);
    return tools[0].function.name;
}

function receipt(request: ScriptedToolRequest, callId: string): Record<string, unknown> {
    const wire = request.messages.find((message) => message.role === 'tool' && message.tool_call_id === callId);
    if (typeof wire?.content !== 'string') throw new Error(`Missing correlated receipt ${callId}`);
    const value: unknown = JSON.parse(wire.content);
    if (!isRecord(value) || value.status !== 'success' || !isRecord(value.data))
        throw new Error(`Read ${callId} was not successful`);
    return value.data;
}

function numericHits(data: Record<string, unknown>) {
    expect(data.kind).toBe('transient-onset-read');
    expect(data.timeAxis).toBe('source-buffer');
    if (typeof data.sampleRate !== 'number' || !Array.isArray(data.hits))
        throw new Error('Source geometry or numeric page is absent');
    let previous = -1;
    for (const hit of data.hits as unknown[]) {
        if (!isRecord(hit) || typeof hit.sourceSeconds !== 'number' || typeof hit.confidence !== 'number')
            throw new Error('Onset hit is not numeric');
        expect(Object.keys(hit).sort()).toEqual(['confidence', 'sourceSeconds']);
        expect(hit.sourceSeconds).toBeGreaterThan(previous);
        const sourceFrame = hit.sourceSeconds * data.sampleRate;
        expect(sourceFrame).toBeCloseTo(Math.round(sourceFrame), 6);
        expect(hit.confidence).toBeGreaterThanOrEqual(0);
        expect(hit.confidence).toBeLessThanOrEqual(1);
        previous = hit.sourceSeconds;
    }
    return data.hits.length;
}

async function sourceState(page: Page) {
    return page.evaluate(async () => {
        const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
        const { audioBufferCache } = await import('/src/modules/AudioEngine/stores/index.ts');
        const { audioWarpStore } = await import('/src/modules/ElasticAudio/stores/index.ts');
        const { undoHistoryStore } = await import('/src/modules/Command/stores/index.ts');
        const { captureProjectRevision, getCrdtDoc, settlePendingProjectWritesAndCaptureRevision } =
            await import('/src/modules/CrdtDocument/useCases/index.ts');
        settlePendingProjectWritesAndCaptureRevision();
        const clips = (trackStore.value?.tracks ?? [])
            .flatMap((track) => track.clips)
            .filter((clip) => clip.type === 'audio');
        const source = clips[0]?.audioBufferId ? audioBufferCache.get(clips[0].audioBufferId) : undefined;
        const pcmDigests: string[] = [];
        if (source !== undefined) {
            for (let channel = 0; channel < source.numberOfChannels; channel++) {
                const samples = new Float32Array(source.getChannelData(channel));
                const hash = await crypto.subtle.digest('SHA-256', samples.buffer);
                pcmDigests.push(Array.from(new Uint8Array(hash)).join(','));
            }
        }
        return {
            clips: clips.map((clip) => ({ id: clip.id, name: clip.name })),
            sourceReady: source !== undefined,
            sampleRate: source?.sampleRate,
            frameCount: source?.length,
            pcmDigests,
            revision: captureProjectRevision(),
            document: JSON.stringify(getCrdtDoc('root')),
            warp: JSON.stringify(audioWarpStore.value),
            history: JSON.stringify(undoHistoryStore.value),
        };
    });
}

test('source-onset read crosses the real chat planner and Worker with numeric pages and no project mutation', async ({
    page,
}, testInfo) => {
    test.setTimeout(120_000);
    await setupWorkspace(page);
    await launch_new_project(page);
    const modifier = await page.evaluate(() => (navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control'));
    await page.keyboard.press(`${modifier}+K`);
    const palette = page.getByRole('dialog', { name: /Command Palette/i });
    await expect(palette).toBeVisible();
    await palette.getByPlaceholder(/Type a command/i).fill('Add Audio Track');
    await palette.getByRole('option', { name: /Add Audio Track/i }).click();
    const row = page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('row')
        .first();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    await (await chooser).setFiles({ name: 'private-onset-source.wav', mimeType: 'audio/wav', buffer: onsetWav() });
    await expect
        .poll(async () => {
            const state = await sourceState(page);
            return state.clips.length === 1 && state.sourceReady;
        })
        .toBe(true);
    const imported = await sourceState(page);
    expect(imported.clips).toHaveLength(1);
    let firstPage: Record<string, unknown> | undefined;
    let secondPage: Record<string, unknown> | undefined;
    const provider = await startScriptedToolProvider((request, turn) => {
        expect(turn).toBeLessThan(4);
        if (turn === 0)
            return [
                {
                    id: 'onset-catalog',
                    name: toolWith(request, ['category', 'names']),
                    arguments: { category: 'analysis', names: [READ] },
                },
            ];
        if (turn === 1) {
            const readTool = toolWith(request, ['clipId', 'sensitivity', 'cursor']);
            const catalog = receipt(request, 'onset-catalog');
            expect(catalog.category).toBe('analysis');
            expect(catalog.items).toEqual([
                expect.objectContaining({
                    function: expect.objectContaining({
                        name: READ,
                        parameters: request.tools.find((tool) => tool.function.name === readTool)?.function.parameters,
                    }),
                }),
            ]);
            return [{ id: 'onsets-1', name: readTool, arguments: { clipId: imported.clips[0].id } }];
        }
        if (turn === 2) {
            firstPage = receipt(request, 'onsets-1');
            expect(numericHits(firstPage)).toBe(64);
            expect(firstPage.sampleRate).toBe(imported.sampleRate);
            expect(firstPage.frameCount).toBe(imported.frameCount);
            expect(firstPage.complete).toBe(false);
            expect(typeof firstPage.nextCursor).toBe('string');
            return [
                {
                    id: 'onsets-2',
                    name: toolWith(request, ['clipId', 'sensitivity', 'cursor']),
                    arguments: { clipId: imported.clips[0].id, cursor: firstPage.nextCursor },
                },
            ];
        }
        secondPage = receipt(request, 'onsets-2');
        expect(numericHits(secondPage)).toBeGreaterThan(0);
        expect(secondPage.complete).toBe(true);
        expect(secondPage.nextCursor).toBeNull();
        expect(secondPage.coverage).toMatchObject({ offset: 64, endOffset: secondPage.totalHitCount });
        return [
            {
                id: 'onset-answer',
                name: toolWith(request, ['text', 'evidenceCallIds']),
                arguments: {
                    text: 'The source-buffer onset pages report seconds and confidence without changing markers.',
                    evidenceCallIds: ['onsets-1', 'onsets-2'],
                },
            },
        ];
    });
    try {
        await admitLoopbackProvider(page, provider);
        await page.getByTestId('toggle-chat').click();
        const composer = page.getByTestId('chat-composer-input');
        await expect(composer).toBeVisible();
        await expect(composer).toBeEnabled();
        await page.getByRole('combobox', { name: 'Agent execution mode' }).selectOption('apply');
        const before = await sourceState(page);
        await composer.fill(
            `Show source onset times and confidence for the audio clip "${imported.clips[0].name}". Do not create markers or edit the project.`
        );
        await composer.press('Enter');
        await expect
            .poll(() => ({ requests: provider.requests.length, failures: provider.failures }), { timeout: 30_000 })
            .toEqual({ requests: 4, failures: [] });
        expect(provider.failures).toEqual([]);
        await expect(page.getByRole('log', { name: 'Chat conversation' })).toContainText(
            'The source-buffer onset pages report seconds and confidence without changing markers.'
        );
        await expect(composer).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Confirm pending actions', exact: true })).toHaveCount(0);
        const after = await sourceState(page);
        expect(after.document).toBe(before.document);
        expect(after.revision).toBe(before.revision);
        expect(after.warp).toBe(before.warp);
        expect(after.history).toBe(before.history);
        expect(after.pcmDigests).toEqual(before.pcmDigests);
        const wire = provider.completionRequests.join('\n');
        expect(wire).toContain('transient-onset-read');
        expect(wire).not.toMatch(/"(?:pcm|channelData|channels|getChannelData|audioBufferId|fileId)"/);
        await testInfo.attach('source-onset-pages', {
            body: JSON.stringify({ firstPage, secondPage }),
            contentType: 'application/json',
        });
    } finally {
        await provider.close();
    }
});

import { test, expect, type Page } from '@playwright/test';

import { createLoopbackAnswerIntake, createLoopbackAnswerToolCalls } from '../../scripts/loopbackOpenAiProvider';

import { admitLoopbackProvider } from './admitLoopbackProvider';
import { launch_new_project, setupWorkspace } from './e2eUtils';
import { startLoopbackOpenAiProvider, type LoopbackOpenAiProvider } from './loopbackOpenAiProvider';
import { startScriptedToolProvider } from './scriptedToolProvider';

const LOOPBACK_REPLY = 'Loopback provider reply for the confirm/apply/undo proof.';

function sineWav(): Buffer {
    const rate = 48_000;
    const frames = rate * 4;
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
    for (let frame = 0; frame < frames; frame++) {
        wav.writeInt16LE(Math.round(0.1 * 32767 * Math.sin((2 * Math.PI * 1000 * frame) / rate)), 44 + frame * 2);
    }
    return wav;
}

async function projectTruth(page: Page) {
    return page.evaluate(async () => {
        const { captureProjectRevision, settlePendingProjectWritesAndCaptureRevision, getCrdtDoc } =
            await import('/src/modules/CrdtDocument/useCases/index.ts');
        const { undoHistoryStore } = await import('/src/modules/Command/stores/index.ts');
        const { actionHistoryStore } = await import('/src/modules/CrdtDocument/stores/index.ts');
        const { transportStore } = await import('/src/modules/Transport/stores/index.ts');
        settlePendingProjectWritesAndCaptureRevision();
        return {
            revision: captureProjectRevision(),
            document: JSON.stringify(getCrdtDoc('root')),
            undo: JSON.stringify(undoHistoryStore.value),
            history: JSON.stringify(actionHistoryStore.value),
            transport: JSON.stringify(transportStore.value),
        };
    });
}

function trackArmButtons(page: Page) {
    return page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('button', { name: /^Arm / });
}

async function openChatPanel(page: Page): Promise<void> {
    await page.getByTestId('toggle-chat').click();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 10_000 });
}

// The confirm half of the prompt flow: proposal buttons are covered
// (mount + cancel) but no spec clicks Confirm and asserts the project actually
// mutates, let alone that the applied batch is undoable and redoable.
//
// The composer needs an admitted AI backend. WebGPU cannot supply one on a
// GPU-less runner, so these tests admit the other documented browser path: an
// unauthenticated OpenAI-compatible endpoint on loopback, configured through
// the product's own `configureCloudProvider`.
test.describe('AI chat over an admitted loopback provider', () => {
    let provider: LoopbackOpenAiProvider;

    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        provider = await startLoopbackOpenAiProvider({
            reply: LOOPBACK_REPLY,
            toolCalls: createLoopbackAnswerToolCalls(),
        });
        await setupWorkspace(page);
        await launch_new_project(page);
        await admitLoopbackProvider(page, provider);
        await openChatPanel(page);
    });

    test.afterEach(async () => {
        await provider.close();
    });

    // Explain reads project evidence through the configured endpoint and completes a tool-backed answer.
    test('shows a completed answer from the configured loopback endpoint', async ({ page }) => {
        const input = page.getByTestId('chat-composer-input');
        await expect(input).toBeEnabled();

        const executionMode = page.getByRole('combobox', { name: 'Agent execution mode' });
        await expect(executionMode).toHaveValue('explain');
        const baseline = await trackArmButtons(page).count();
        const undo = page.getByTestId('transport-undo');
        const redo = page.getByTestId('transport-redo');
        const undoEnabled = await undo.isEnabled();
        const redoEnabled = await redo.isEnabled();
        const play = page.getByTestId('transport-play');
        const playLabel = await play.getAttribute('aria-label');

        await input.fill('Describe the project structure and tempo setting.');
        await input.press('Enter');

        const conversation = page.getByRole('log', { name: 'Chat conversation' });
        await expect(conversation).toContainText(
            `The project has ${String(baseline)} audio/MIDI track(s), 0 bus(es), and 0 folder(s). Master output is separate. Tempo is 120 BPM in 4/4.`,
            {
                timeout: 30_000,
            }
        );
        expect(provider.completionRequests.length).toBeGreaterThan(0);
        expect(provider.completionRequests[0]).toContain(provider.model);
        expect(provider.completionRequests).toHaveLength(3);
        const first = JSON.parse(provider.completionRequests[0]!) as { tools: Array<{ function: { name: string } }> };
        const second = JSON.parse(provider.completionRequests[2]!) as {
            tools: Array<{ function: { name: string } }>;
            messages: Array<{ role: string; tool_call_id?: string; content: string }>;
        };
        expect(first.tools.map((tool) => tool.function.name)).toContain('selectAnswerInterpretation');
        expect(second.tools.map((tool) => tool.function.name)).toContain('answer_respond');
        const receipt = second.messages.find(
            (message) => message.role === 'tool' && message.tool_call_id === 'loopback-query'
        );
        expect(receipt).toBeDefined();
        expect(JSON.parse(receipt!.content)).toMatchObject({
            callId: 'loopback-query',
            toolName: 'project.query',
            status: 'success',
        });
        await conversation.getByRole('button', { name: /Evidence/ }).click();
        await expect(conversation.getByRole('list', { name: 'Evidence' })).toContainText('project.query');
        await expect(conversation.getByRole('list', { name: 'Evidence' })).toContainText('selectAnswerInterpretation');
        await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
        await expect(trackArmButtons(page)).toHaveCount(baseline);
        expect(await undo.isEnabled()).toBe(undoEnabled);
        expect(await redo.isEnabled()).toBe(redoEnabled);
        await expect(play).toHaveAttribute('aria-label', playLabel!);
    });

    for (const mode of ['plan', 'explain'] as const) {
        test(`composes measured master figures through ${mode} with no project change`, async ({ page }) => {
            await provider.close();
            let range: { startBeat: number; endBeat: number } | undefined;
            let figures:
                Record<string, { status: string; value: number; unit: string; confidence: string }> | undefined;
            const measuredProvider = await startScriptedToolProvider((request, turn) => {
                if (turn === 0) {
                    const call = createLoopbackAnswerIntake(request, {
                        kind: 'measured-audio',
                        topicIds: ['level'],
                        scopeCandidateIds: ['master'],
                        rangeCandidateId: 'arrangement',
                    });
                    expect(
                        request.tools.some(
                            (tool) =>
                                tool.function.name ===
                                (mode === 'explain' ? 'selectAnswerInterpretation' : 'selectCreativeInterpretation')
                        )
                    ).toBe(true);
                    return [call];
                }
                if (turn === 1) {
                    return [{ id: 'query', name: 'project_query', arguments: { type: 'project-summary' } }];
                }
                if (turn === 2) {
                    const wire = request.messages.find(
                        (message) => message.role === 'tool' && message.tool_call_id === 'intake'
                    );
                    const data = JSON.parse(wire?.content ?? 'null') as {
                        data: { range: { startBeat: number; endBeat: number } };
                    };
                    range = data.data.range;
                    return [
                        {
                            id: 'measure',
                            name: 'analysis_measure',
                            arguments: {
                                scope: { kind: 'master' },
                                range: { startBeat: range.startBeat, endBeat: range.endBeat },
                            },
                        },
                    ];
                }
                expect(turn).toBe(3);
                const wire = request.messages.find(
                    (message) => message.role === 'tool' && message.tool_call_id === 'measure'
                );
                const receipt = JSON.parse(wire?.content ?? 'null') as {
                    status: string;
                    data: {
                        kind: string;
                        targets: Array<{ targetId: string; measurements: NonNullable<typeof figures> }>;
                    };
                };
                expect(receipt.status).toBe('success');
                expect(receipt.data.kind).toBe('analysis-measurement');
                expect(receipt.data.targets[0]?.targetId).toBe('master');
                figures = receipt.data.targets[0]!.measurements;
                expect(figures.integratedLoudness?.status).toBe('measured');
                expect(figures.truePeak?.status).toBe('measured');
                return [
                    {
                        id: 'answer',
                        name: 'answer_respond',
                        arguments: {
                            intakeCallId: 'intake',
                            statements: [
                                { kind: 'query-page', callId: 'query' },
                                {
                                    kind: 'metric',
                                    reference: {
                                        callId: 'measure',
                                        targetId: 'master',
                                        metricId: 'integratedLoudness',
                                    },
                                },
                                {
                                    kind: 'metric',
                                    reference: { callId: 'measure', targetId: 'master', metricId: 'truePeak' },
                                },
                            ],
                        },
                    },
                ];
            });
            provider = measuredProvider;
            const modifier = await page.evaluate(() =>
                navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control'
            );
            await page.keyboard.press(`${modifier}+K`);
            const palette = page.getByRole('dialog', { name: /Command Palette/i });
            await palette.getByPlaceholder(/Type a command/i).fill('Add Audio Track');
            await palette.getByRole('option', { name: /Add Audio Track/i }).click();
            const row = page
                .getByRole('grid', { name: /Track list/i })
                .first()
                .getByRole('row')
                .first();
            await row.click({ button: 'right' });
            const chooser = page.waitForEvent('filechooser');
            await page.getByRole('menuitem', { name: /Import Audio/i }).click();
            await (await chooser).setFiles({ name: 'measured-sine.wav', mimeType: 'audio/wav', buffer: sineWav() });
            await expect
                .poll(() =>
                    page.evaluate(async () => {
                        const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
                        return (trackStore.value?.tracks ?? []).some((track) =>
                            track.clips.some((clip) => clip.type === 'audio')
                        );
                    })
                )
                .toBe(true);
            await admitLoopbackProvider(page, measuredProvider);
            await page.getByRole('combobox', { name: 'Agent execution mode' }).selectOption(mode);
            const before = await projectTruth(page);
            const composer = page.getByTestId('chat-composer-input');
            await composer.fill('What are the master integrated loudness and true peak over the arrangement?');
            await composer.press('Enter');
            const conversation = page.getByRole('log', { name: 'Chat conversation' });
            await expect(conversation).toContainText('Master output true peak is', { timeout: 45_000 });
            expect(measuredProvider.failures).toEqual([]);
            expect(measuredProvider.requests).toHaveLength(4);
            if (figures === undefined || range === undefined) {
                throw new Error('Actual successful measurement did not reach the provider.');
            }
            for (const [metric, label] of [
                ['integratedLoudness', 'integrated loudness'],
                ['truePeak', 'true peak'],
            ] as const) {
                const value = figures[metric]!;
                expect(Number.isFinite(value.value)).toBe(true);
                const rounded = Math.round(value.value * 100) / 100;
                await expect(conversation).toContainText(
                    `Master output ${label} is ${String(Object.is(rounded, -0) ? 0 : rounded)} ${value.unit} (${value.confidence})`
                );
            }
            await expect(conversation).toContainText(
                `Over “Arrangement” (beats ${String(range.startBeat)}–${String(range.endBeat)})`
            );
            await conversation.getByRole('button', { name: /Evidence/ }).click();
            await expect(conversation.getByRole('list', { name: 'Evidence' })).toContainText('analysis.measure');
            await expect(conversation.getByRole('list', { name: 'Evidence' })).toContainText(
                mode === 'explain' ? 'selectAnswerInterpretation' : 'selectCreativeInterpretation'
            );
            await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
            expect(await projectTruth(page)).toEqual(before);
            expect(measuredProvider.completionRequests.join('\n')).not.toMatch(
                /"(?:pcm|channelData|channels|getChannelData|audioBufferId|fileId)"/
            );
        });
    }

    test('confirming "create 3 audio tracks" adds the tracks, undo restores, redo re-applies', async ({ page }) => {
        const input = page.getByTestId('chat-composer-input');
        await expect(input).toBeEnabled();

        const executionMode = page.getByRole('combobox', { name: 'Agent execution mode' });
        await executionMode.selectOption('apply');
        await expect(executionMode).toHaveValue('apply');
        const baseline = await trackArmButtons(page).count();

        // Multi-action fast path forces a confirmation proposal.
        await input.fill('create 3 audio tracks');
        await input.press('Enter');
        const confirm = page.getByRole('button', { name: 'Confirm' });
        await expect(confirm).toBeVisible({ timeout: 15_000 });

        await confirm.click();
        // The confirmed batch runs through the action pipeline; give the
        // tracks the same landing allowance the proposal needed.
        await expect(trackArmButtons(page)).toHaveCount(baseline + 3, { timeout: 20_000 });

        // The batch is one grouped undo entry: undo removes all three tracks,
        // redo re-applies them.
        const undo = page.getByTestId('transport-undo');
        const redo = page.getByTestId('transport-redo');
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect(trackArmButtons(page)).toHaveCount(baseline);

        await redo.click();
        await expect(trackArmButtons(page)).toHaveCount(baseline + 3);
    });
});

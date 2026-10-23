import { expect, test, type Page } from '@playwright/test';

import { admitLoopbackProvider } from './admitLoopbackProvider';
import { launch_new_project, setupWorkspace } from './e2eUtils';
import { startScriptedToolProvider, type ScriptedToolRequest } from './scriptedToolProvider';

type Target = { id: string; name: string; gain: number };

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reply with the wire name actually offered by the adapter, selected by its schema contract. */
function offeredTool(request: ScriptedToolRequest, property: string): string {
    const matches = request.tools.filter((tool) => property in tool.function.parameters.properties);
    expect(matches, `one offered tool with ${property}`).toHaveLength(1);
    return matches[0].function.name;
}

function receiptData(request: ScriptedToolRequest, callId: string): Record<string, unknown> {
    const message = request.messages.find(
        (candidate) => candidate.role === 'tool' && candidate.tool_call_id === callId
    );
    if (typeof message?.content !== 'string') {
        throw new Error(`No application receipt for ${callId}.`);
    }
    const receipt: unknown = JSON.parse(message.content);
    if (!isRecord(receipt) || receipt.status !== 'success' || !isRecord(receipt.data)) {
        throw new Error(`Application did not successfully execute ${callId}.`);
    }
    return receipt.data;
}

function targetsFromReceipt(request: ScriptedToolRequest, names: string[]): Target[] {
    const receipt = receiptData(request, 'project-read');
    expect(receipt.schema).toBe('sourdaw.semantic-project-query');
    expect(receipt.nextCursor).toBeNull();
    if (!Array.isArray(receipt.items)) {
        throw new Error('Project query returned no items.');
    }
    const items: unknown[] = receipt.items;
    return names.map((name) => {
        const matches = items.filter((item) => isRecord(item) && item.kind === 'track' && item.name === name);
        expect(matches, name).toHaveLength(1);
        const track: unknown = matches[0];
        if (!isRecord(track) || typeof track.id !== 'string' || typeof track.gain !== 'number') {
            throw new Error('Project query did not disclose the track identity and gain.');
        }
        return { id: track.id, name, gain: track.gain };
    });
}

async function readProject(page: Page) {
    return page.evaluate(async () => {
        const { captureProjectRevision, getCrdtDoc } = await import('/src/modules/CrdtDocument/useCases/index.ts');
        const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
        const { getTrackStrip } = await import('/src/modules/AudioEngine/useCases/index.ts');
        const { undoHistoryStore } = await import('/src/modules/Command/stores/index.ts');
        const root = getCrdtDoc<{ tracks: { tracks: Array<{ id: string; gain: number }> } }>('root');
        if (root === undefined || !Array.isArray(root.tracks?.tracks)) {
            throw new Error('The real Automerge root has no track slot.');
        }
        const audioTracks = (trackStore.value?.tracks ?? []).filter((track) => track.kind === 'audio');
        return {
            document: JSON.stringify(root),
            revision: captureProjectRevision(),
            rawTracks: root.tracks.tracks.map((track) => ({ id: track.id, gain: track.gain })),
            tracks: audioTracks.map((track) => ({
                id: track.id,
                name: track.name,
                gain: track.gain,
            })),
            runtime: audioTracks.map((track) => {
                const strip = getTrackStrip(track.id);
                if (strip === undefined) {
                    throw new Error(`No real audio strip for ${track.name}.`);
                }
                return { id: track.id, gain: strip.faderNode.gain.value, contextState: strip.faderNode.context.state };
            }),
            history: {
                past: (undoHistoryStore.value?.past ?? []).map((entry) => ({ id: entry.id, groupId: entry.groupId })),
                future: (undoHistoryStore.value?.future ?? []).map((entry) => ({
                    id: entry.id,
                    groupId: entry.groupId,
                })),
            },
        };
    });
}

async function readAgent(page: Page) {
    return page.evaluate(async () => {
        const { agentRunStore, pendingActionConfirmationStore } =
            await import('/src/modules/AiRuntime/stores/index.ts');
        const { getAgentApprovalView } = await import('/src/modules/AiRuntime/useCases/index.ts');
        const { parseVersionedCommandBatchEnvelope } = await import('/src/modules/Command/useCases/index.ts');
        const confirmations = (pendingActionConfirmationStore.value?.confirmations ?? []).map((confirmation) => {
            const batch = confirmation.approvalSnapshot.commandBatch;
            const parsed = batch ? parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority) : null;
            return {
                id: confirmation.id,
                runId: confirmation.runId,
                status: confirmation.status,
                actions: confirmation.approvalSnapshot.actions,
                approval: confirmation.approvalSnapshot.agentApproval,
                view: getAgentApprovalView({ confirmationId: confirmation.id }),
                envelope: parsed?.status === 'valid' ? parsed.envelope : null,
            };
        });
        return { confirmations, runs: structuredClone(agentRunStore.value?.runs ?? []) };
    });
}

async function addAudioTrack(page: Page, name: string): Promise<void> {
    const arms = page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('button', { name: /^Arm / });
    const before = await arms.count();
    const modifier = await page.evaluate(() => (navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control'));
    await page.keyboard.press(`${modifier}+K`);
    const palette = page.getByRole('dialog', { name: /Command Palette/i });
    await expect(palette).toBeVisible();
    await palette.getByPlaceholder(/Type a command/i).fill('Add Audio Track');
    await palette.getByRole('option', { name: /Add Audio Track/i }).click();
    await expect(arms).toHaveCount(before + 1);
    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    const nameButton = inspector.getByRole('button', { name: 'Audio', exact: true });
    await expect(nameButton).toBeVisible();
    await nameButton.click();
    const rename = inspector.getByRole('textbox').first();
    await expect(rename).toBeVisible();
    await rename.fill(name);
    await rename.press('Enter');
    await expect(page.getByRole('button', { name: `Arm ${name}`, exact: true })).toBeVisible();
}

async function expectGains(page: Page, expected: Array<{ id: string; gain: number }>): Promise<void> {
    await expect
        .poll(
            async () => {
                const project = await readProject(page);
                return expected.every(({ id, gain }) => {
                    const raw = project.rawTracks.find((track) => track.id === id);
                    const projected = project.tracks.find((track) => track.id === id);
                    const runtime = project.runtime.find((track) => track.id === id);
                    return (
                        raw?.gain === gain &&
                        projected?.gain === gain &&
                        runtime?.contextState === 'running' &&
                        Math.abs(runtime.gain - gain) < 0.0001
                    );
                });
            },
            { timeout: 20_000 }
        )
        .toBe(true);
}

test.describe('provider tool authority through the live chat composition', () => {
    test.use({ actionTimeout: 15_000 });
    for (const scenario of ['approved', 'malformed', 'undisclosed'] as const) {
        test(`${scenario}: provider discovery, proposal and exact user approval`, async ({ page }, testInfo) => {
            test.setTimeout(120_000);
            await setupWorkspace(page);
            await launch_new_project(page);
            await addAudioTrack(page, 'Proof Piano');
            await addAudioTrack(page, 'Proof Bass');
            // Live strips are materialized by the normal transport path, not by track creation.
            await page.getByTestId('transport-play').click();
            await expect(page.getByTestId('transport-play')).toHaveAttribute('aria-label', 'Pause');
            await page.getByTestId('transport-stop').click();
            await expect(page.getByTestId('transport-play')).toHaveAttribute('aria-label', 'Play');
            const initial = await readProject(page);
            const targets = initial.tracks.slice(-2);
            expect(targets).toHaveLength(2);
            await expectGains(page, initial.tracks);
            const names = targets.map((track) => track.name);
            let disclosedTargets: Target[] = [];
            let proposalCommands: Array<{ name: string; arguments: Record<string, unknown> }> = [];
            const provider = await startScriptedToolProvider((request, turn) => {
                expect(request.model).toBe(provider.model);
                // Grounding admits one correction attempt; repeat the malformed proposal there.
                const planningTurn = scenario === 'malformed' ? turn % 3 : turn;
                expect(turn).toBeLessThan(scenario === 'malformed' ? 6 : 3);
                if (planningTurn === 0) {
                    return [
                        {
                            id: 'project-read',
                            name: offeredTool(request, 'sinceRevision'),
                            arguments: { type: 'object', page: { limit: 50 } },
                        },
                    ];
                }
                disclosedTargets = targetsFromReceipt(request, names);
                if (scenario !== 'undisclosed' && planningTurn === 1) {
                    return [
                        {
                            id: 'command-discovery',
                            name: offeredTool(request, 'category'),
                            arguments: { category: 'command', names: ['setTrackGain'] },
                        },
                    ];
                }
                let commandName = 'setTrackGain';
                if (scenario !== 'undisclosed') {
                    const catalog = receiptData(request, 'command-discovery');
                    expect(catalog.schema).toBe('sourdaw.agent-tool-catalog');
                    expect(catalog.nextCursor).toBeNull();
                    expect(catalog.items).toHaveLength(1);
                    const entry: unknown = Array.isArray(catalog.items) ? catalog.items[0] : null;
                    if (!isRecord(entry) || !isRecord(entry.function) || typeof entry.function.name !== 'string') {
                        throw new Error('Catalog did not disclose a command schema.');
                    }
                    commandName = entry.function.name;
                    expect(commandName).toBe('setTrackGain');
                    expect(entry.function.parameters).toEqual(
                        request.tools.find((tool) => tool.function.name === commandName)?.function.parameters
                    );
                    expect(entry.function.parameters).toMatchObject({
                        properties: { trackId: { type: 'string' }, gainDb: { type: 'number' } },
                        additionalProperties: false,
                    });
                }
                proposalCommands = disclosedTargets.map((track, index) => ({
                    name: commandName,
                    arguments: { trackId: track.id, gainDb: scenario === 'malformed' ? 'quiet' : [-6, -9][index] },
                }));
                expect(planningTurn).toBe(scenario === 'undisclosed' ? 1 : 2);
                return [
                    {
                        id: 'gain-proposal',
                        name: offeredTool(request, 'compiledCallIds'),
                        arguments: {
                            commands: proposalCommands,
                            plan: {
                                semantic: { classification: 'complex', uncertainty: [] },
                                objective: 'Set the two named track faders to their requested decibel levels.',
                                constraints: [],
                                scope: {
                                    targetIds: disclosedTargets.map((track) => track.id),
                                    targetRanges: [],
                                    protectedTargetIds: [],
                                    protectedRanges: [],
                                },
                                capabilityIds: [commandName],
                                assetIds: [],
                                alternatives: [],
                                validationStrategy: ['Verify the two fader values before and after approval.'],
                                stoppingConditions: ['Stop after the one approved batch commits.'],
                            },
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
                const before = await readProject(page);
                const prompt = `The mix needs more space. Set "${names[0]}" volume to -6 dB and set "${names[1]}" volume to -9 dB.`;
                await composer.fill(prompt);
                await composer.press('Enter');
                await expect
                    .poll(() => provider.requests.length, { timeout: 30_000 })
                    .toBe(scenario === 'undisclosed' ? 2 : scenario === 'malformed' ? 6 : 3);
                expect(provider.failures).toEqual([]);
                expect(disclosedTargets.map((track) => track.id)).toEqual(targets.map((track) => track.id));
                const confirm = page.getByRole('button', { name: 'Confirm pending actions', exact: true });
                if (scenario !== 'approved') {
                    await expect(page.getByRole('log', { name: 'Chat conversation' })).toContainText(
                        scenario === 'undisclosed' ? /undiscovered catalog command/i : /reject|invalid|does not match/i,
                        { timeout: 20_000 }
                    );
                    await expect(composer).toBeEnabled();
                    await expect(confirm).toHaveCount(0);
                    const after = await readProject(page);
                    expect(after.document).toBe(before.document);
                    expect(after.revision).toBe(before.revision);
                    expect(after.history).toEqual(before.history);
                    await expectGains(page, before.tracks);
                    const agent = await readAgent(page);
                    expect(agent.confirmations.filter((entry) => entry.status === 'proposed')).toEqual([]);
                    expect(agent.runs.flatMap((run) => run.committedWork)).toEqual([]);
                    expect(agent.runs.flatMap((run) => run.receipts)).toEqual([]);
                    await testInfo.attach('rejected-proposal', {
                        body: JSON.stringify({ scenario, proposalCommands, agent, project: after }, null, 2),
                        contentType: 'application/json',
                    });
                    return;
                }
                await expect(confirm).toBeVisible({ timeout: 20_000 });
                const pending = (await readAgent(page)).confirmations.find((entry) => entry.status === 'proposed');
                expect(pending).toBeDefined();
                if (!pending?.envelope || !pending.approval || !pending.view) {
                    throw new Error('No exact application-owned approval envelope.');
                }
                expect(
                    pending.envelope.commands.map((command) => ({
                        name: command.operation,
                        trackId: command.arguments.trackId,
                        gainDb: command.arguments.gainDb,
                    }))
                ).toEqual(
                    proposalCommands.map((command) => ({
                        name: command.name,
                        trackId: command.arguments.trackId,
                        gainDb: command.arguments.gainDb,
                    }))
                );
                expect(pending.approval.sourceRevision).toBe(pending.envelope.baseRevision);
                expect(pending.approval.actionHashes).toHaveLength(2);
                expect(pending.view.freshness.status).toBe('current');
                const proposed = await readProject(page);
                expect(proposed.document).toBe(before.document);
                expect(proposed.revision).toBe(before.revision);
                expect(proposed.history).toEqual(before.history);
                await expectGains(page, before.tracks);
                const privacyToast = page.getByRole('status').filter({ hasText: 'Hosted AI privacy disclosure' });
                // Each hosted request publishes one queued notice; dismiss through its real UI.
                for (let remaining = provider.requests.length; remaining > 0; remaining -= 1) {
                    if ((await privacyToast.count()) === 0) {
                        break;
                    }
                    await privacyToast.getByRole('button', { name: 'Dismiss', exact: true }).click();
                }
                await expect(privacyToast).toHaveCount(0);
                const beforeConfirm = await readProject(page);
                expect(beforeConfirm.document).toBe(before.document);
                expect(beforeConfirm.revision).toBe(pending.envelope.baseRevision);
                expect(beforeConfirm.history).toEqual(before.history);
                const currentApproval = (await readAgent(page)).confirmations.find((entry) => entry.id === pending.id);
                expect(currentApproval?.view?.freshness.status).toBe('current');
                await testInfo.attach('before-pointer-confirmation', {
                    body: JSON.stringify({ pending, currentApproval, project: beforeConfirm }, null, 2),
                    contentType: 'application/json',
                });
                await confirm.click();
                const expected = targets.map((track, index) => ({ id: track.id, gain: 10 ** ([-6, -9][index] / 20) }));
                await expectGains(page, expected);
                await expect
                    .poll(async () => (await readAgent(page)).runs.find((run) => run.runId === pending.runId)?.phase)
                    .toBe('completed');
                const committed = await readProject(page);
                expect(committed.revision).not.toBe(before.revision);
                const agent = await readAgent(page);
                const run = agent.runs.find((candidate) => candidate.runId === pending.runId);
                expect(run?.revisions.approved).toBe(pending.envelope.baseRevision);
                expect(run?.revisions.committed).toBeTruthy();
                const batch = run?.batches.find((candidate) => candidate.batchId === pending.envelope?.batchId);
                expect(batch?.status).toBe('committed');
                expect(batch?.commandIds).toEqual(pending.envelope.commands.map((command) => command.commandId));
                const receipt = run?.receipts.find((candidate) => candidate.workId === pending.envelope?.batchId);
                expect(receipt?.receiptIdentity).toBe(batch?.receiptIdentity);
                expect(receipt?.receiptIdentity).toContain(`:${pending.runId}:${pending.envelope.batchId}:committed`);
                expect(receipt?.revertGroupId).toBe(pending.envelope.batchId);
                const addedHistory = committed.history.past.slice(before.history.past.length);
                expect(addedHistory).toHaveLength(2);
                expect(addedHistory.every((entry) => entry.groupId === receipt?.revertGroupId)).toBe(true);
                await page.getByTestId('transport-undo').click();
                await expectGains(page, before.tracks);
                expect((await readProject(page)).history.past).toEqual(before.history.past);
                await page.getByTestId('transport-redo').click();
                await expectGains(page, expected);
                await testInfo.attach('provider-command-authority', {
                    body: JSON.stringify(
                        { proposalCommands, pending, run, before, committed, redone: await readProject(page) },
                        null,
                        2
                    ),
                    contentType: 'application/json',
                });
            } finally {
                await testInfo.attach('agent-state', {
                    body: JSON.stringify(await readAgent(page), null, 2),
                    contentType: 'application/json',
                });
                await testInfo.attach('project-state', {
                    body: JSON.stringify(await readProject(page), null, 2),
                    contentType: 'application/json',
                });
                await testInfo.attach('scripted-provider-requests', {
                    body: JSON.stringify({ requests: provider.requests, failures: provider.failures }, null, 2),
                    contentType: 'application/json',
                });
                await provider.close();
            }
        });
    }
});

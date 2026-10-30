import { expect, test, type Page } from '@playwright/test';

import { advertisedAnswerCandidateId } from '../../src/modules/AiRuntime/useCases/__tests__/answerWireFixture';

import { admitLoopbackProvider } from './admitLoopbackProvider';
import { launch_new_project, setupWorkspace } from './e2eUtils';
import { startScriptedToolProvider, type ScriptedToolRequest } from './scriptedToolProvider';

const PROMPT = 'Match Drums loudness to Bass over Chorus';

function record(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new TypeError('Expected a published planning object.');
    }
    return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return !(value === null || typeof value !== 'object' || Array.isArray(value));
}
function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError('Expected a published planning array.');
    }
    return value;
}
function text(value: unknown): string {
    if (typeof value !== 'string') {
        throw new TypeError('Expected an actual published candidate ID.');
    }
    return value;
}

/** Select only IDs and semantics in the genuine hosted schema and complete shared view. */
function comparisonIntake(request: ScriptedToolRequest, drumsId: string, bassId: string) {
    const tool = request.tools.find((candidate) => candidate.function.name === 'selectCreativeInterpretation');
    if (tool === undefined) {
        throw new Error('Missing the actual joint intake tool.');
    }
    const properties = tool.function.parameters.properties;
    const view = record(JSON.parse((tool.function.description ?? '').split('View: ').at(-1) ?? 'null'));
    const targets = array(view.targets).map(array);
    const targetIds = array(record(record(properties.targetCandidateIds).items).enum).map(text);
    const dimensionIds = array(record(record(properties.editDimensionCandidateIds).items).enum).map(text);
    const dimensions = array(view.dimensions).map(text);
    const targetIndex = targets.findIndex((row) => row[1] === 'track' && row[4] === 'Drums');
    const dimensionIndex = dimensions.indexOf('processing');
    const metric = array(record(properties.metricIntent).anyOf)
        .map(record)
        .find((branch) => branch.properties !== undefined);
    if (targetIndex < 0 || dimensionIndex < 0 || metric === undefined) {
        throw new Error('The actual catalog did not admit the requested bounded comparison.');
    }
    const objectiveProperties = record(record(record(record(metric.properties).objectives).items).properties);
    const objectiveIds = array(record(objectiveProperties.objectiveId).enum).map(text);
    const expectations = array(view.metricExpectations).map(array);
    const policies = array(view.metricPolicies).map(text);
    const policyIndex = policies.indexOf('integrated-loudness-match-v1');
    const objectiveIndex = array(view.metricObjectives)
        .map(array)
        .findIndex((row) =>
            array(row[6]).some((reference) => {
                if (typeof reference !== 'number' || !Number.isSafeInteger(reference)) {
                    throw new TypeError('Expected a published metric expectation index.');
                }
                const expectation = expectations[reference];
                if (expectation === undefined) {
                    return false;
                }
                return (
                    policyIndex >= 0 &&
                    expectation[5] === policyIndex &&
                    expectation[2] === 'match-current' &&
                    expectation[4] === 0.1
                );
            })
        );
    const objectiveId = objectiveIds[objectiveIndex];
    if (objectiveIndex < 0 || objectiveId === undefined) {
        throw new Error('Missing the actual published loudness-match policy objective.');
    }
    return {
        id: 'metric-intake',
        name: tool.function.name,
        arguments: {
            catalogId: text(record(properties.catalogId).const),
            modeId: 'edit',
            uncertainty: 'none',
            targetCandidateIds: [text(targetIds[targetIndex])],
            editDimensionCandidateIds: [text(dimensionIds[dimensionIndex])],
            constraintCandidateIds: [],
            creationSlotIds: [],
            answer: null,
            metricIntent: {
                kind: 'comparative',
                uncertainty: 'none',
                objectives: [
                    {
                        objectiveId,
                        scopeCandidateId: advertisedAnswerCandidateId(request, drumsId),
                        referenceScopeCandidateId: advertisedAnswerCandidateId(request, bassId),
                        rangeCandidateId: advertisedAnswerCandidateId(request, 'Chorus', 'ranges'),
                    },
                ],
            },
        },
    };
}

async function projectTruth(page: Page) {
    return page.evaluate(async () => {
        const crdt: typeof import('../../src/modules/CrdtDocument/useCases') =
            await import('/src/modules/CrdtDocument/useCases/index.ts');
        const command: typeof import('../../src/modules/Command/stores') =
            await import('/src/modules/Command/stores/index.ts');
        const history: typeof import('../../src/modules/CrdtDocument/stores') =
            await import('/src/modules/CrdtDocument/stores/index.ts');
        const transport: typeof import('../../src/modules/Transport/stores') =
            await import('/src/modules/Transport/stores/index.ts');
        crdt.settlePendingProjectWritesAndCaptureRevision();
        return {
            revision: crdt.captureProjectRevision(),
            document: JSON.stringify(crdt.getCrdtDoc('root')),
            undo: JSON.stringify(command.undoHistoryStore.value),
            history: JSON.stringify(history.actionHistoryStore.value),
            transport: JSON.stringify(transport.transportStore.value),
        };
    });
}

for (const entry of ['chat', 'prompt-bar'] as const) {
    test(`keeps the ${entry} comparison visible until actual named-range proof enables approval`, async ({ page }) => {
        test.setTimeout(180_000);
        await setupWorkspace(page);
        await launch_new_project(page);
        const subjects = await page.evaluate(async () => {
            const command: typeof import('../../src/modules/Command/useCases') =
                await import('/src/modules/Command/useCases/index.ts');
            const audio: typeof import('../../src/modules/AudioEngine/useCases') =
                await import('/src/modules/AudioEngine/useCases/index.ts');
            const crdt: typeof import('../../src/modules/CrdtDocument/useCases') =
                await import('/src/modules/CrdtDocument/useCases/index.ts');
            const drumsId = crypto.randomUUID();
            const bassId = crypto.randomUUID();
            const deviceId = crypto.randomUUID();
            const sectionId = crypto.randomUUID();
            for (const [id, name, gain] of [
                [drumsId, 'Drums', 0.8],
                [bassId, 'Bass', 0.4],
            ] as const) {
                const payload = {
                    id,
                    name,
                    kind: 'audio',
                    gain,
                } satisfies Parameters<typeof import('../../src/modules/Arrangement/useCases').addTrack>[0];
                await command.executeAppAction({ type: 'addTrack', payload });
                const rate = 48_000;
                const buffer = new AudioBuffer({ numberOfChannels: 2, sampleRate: rate, length: rate * 2 });
                for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                    const samples = buffer.getChannelData(channel);
                    for (let frame = 0; frame < samples.length; frame++) {
                        samples[frame] = 0.2 * Math.sin((2 * Math.PI * 1000 * frame) / rate);
                    }
                }
                const audioBufferId = audio.cacheAudioBuffer({ buffer });
                await command.executeAppAction({
                    type: 'addClip',
                    payload: {
                        trackId: id,
                        name: `${name} sine`,
                        type: 'audio',
                        startBeat: 0,
                        endBeat: 4,
                        audioBufferId,
                    },
                });
            }
            await command.executeAppAction({
                type: 'addDevice',
                payload: { trackId: drumsId, deviceId, deviceType: 'builtin-gain' },
            });
            await command.executeAppAction({
                type: 'addSection',
                payload: { sectionId, name: 'Chorus', startBeat: 0, endBeat: 4 },
            });
            crdt.settlePendingProjectWritesAndCaptureRevision();
            return { drumsId, bassId, deviceId, sectionId };
        });
        const provider = await startScriptedToolProvider((request, turn) => {
            expect(JSON.stringify(request)).not.toContain(subjects.sectionId);
            if (turn === 0) {
                return [comparisonIntake(request, subjects.drumsId, subjects.bassId)];
            }
            if (turn === 1) {
                return [
                    {
                        id: 'metric-discovery',
                        name: 'agent_catalog_discover',
                        arguments: { category: 'command', names: ['setDeviceParameter'] },
                    },
                ];
            }
            expect(turn).toBe(2);
            return [
                {
                    id: 'metric-proposal',
                    name: 'command_batch_propose',
                    arguments: {
                        commands: [
                            {
                                name: 'setDeviceParameter',
                                arguments: {
                                    deviceId: subjects.deviceId,
                                    paramId: 'gain-level',
                                    value: 20 * Math.log10(0.5),
                                },
                            },
                        ],
                        plan: {
                            semantic: { classification: 'complex', uncertainty: [] },
                            objective: PROMPT,
                            constraints: ['Require compatible measured proof.'],
                            scope: {
                                // Raw parameter commands include the control and its materialized parent track.
                                targetIds: [subjects.deviceId, 'gain-level', subjects.drumsId],
                                targetRanges: [],
                                protectedTargetIds: [],
                                protectedRanges: [],
                            },
                            capabilityIds: [],
                            assetIds: [],
                            alternatives: [],
                            validationStrategy: ['Verify both current preview subjects.'],
                            stoppingConditions: ['Do not apply without compatible actual measurements.'],
                        },
                    },
                },
            ];
        });
        try {
            await admitLoopbackProvider(page, provider);
            const before = await projectTruth(page);
            if (entry === 'chat') {
                await page.getByTestId('toggle-chat').click();
                await page.getByRole('combobox', { name: 'Agent execution mode' }).selectOption('apply');
                await page.getByTestId('chat-composer-input').fill(PROMPT);
                await page.getByTestId('chat-composer-input').press('Enter');
            } else {
                await page.getByTestId('prompt-input').fill(PROMPT);
                await page.getByTestId('prompt-input').press('Enter');
                await expect(page.getByText('Changes awaiting review', { exact: true })).toBeVisible({
                    timeout: 45_000,
                });
                await page.getByRole('button', { name: 'Review in Agent' }).click();
            }
            const confirm = page.getByRole('button', {
                name: entry === 'chat' ? 'Confirm pending actions' : 'Confirm agent actions',
            });
            const repreview = page.getByRole('button', {
                name: entry === 'chat' ? 'Re-preview pending actions' : 'Re-preview agent actions',
                exact: true,
            });
            await expect(confirm).toBeVisible({ timeout: 45_000 });
            await expect(confirm).toBeDisabled();
            await expect(page.getByText('Objective verification: blocked', { exact: true })).toBeVisible();
            expect(provider.failures).toEqual([]);
            expect(provider.requests).toHaveLength(3);
            expect(await projectTruth(page)).toEqual(before);
            await expect(repreview).toBeEnabled();
            await repreview.click();
            await expect(page.getByText('Objective verification: verified', { exact: true })).toBeVisible({
                timeout: 60_000,
            });
            await expect(confirm).toBeEnabled();
            expect(await projectTruth(page)).toEqual(before);
            const evidence = await page.evaluate(async () => {
                const runtime: typeof import('../../src/modules/AiRuntime/useCases') =
                    await import('/src/modules/AiRuntime/useCases/index.ts');
                const stores: typeof import('../../src/modules/AiRuntime/stores') =
                    await import('/src/modules/AiRuntime/stores/index.ts');
                const pending = stores.pendingActionConfirmationStore.value?.confirmations.findLast(
                    (candidate) => candidate.status === 'proposed'
                );
                if (pending === undefined) {
                    throw new Error('Missing the actual persisted verified comparison.');
                }
                return {
                    view: runtime.getAgentApprovalView({ confirmationId: pending.id }),
                    state: pending.approvalSnapshot.metricGoalState,
                    receipts: stores.agentRunStore.value?.runs.find((run) => run.runId === pending.runId)?.plan
                        ?.applicationToolReceipts,
                };
            });
            expect(evidence.view?.metricGoals).toMatchObject({
                status: 'verified',
                criteria: [{ unit: 'LUFS', tolerance: 0.1 }],
            });
            const criterion = evidence.view?.metricGoals.criteria[0];
            expect(criterion?.targetIds).toEqual([subjects.drumsId]);
            expect(criterion?.referenceTargetIds).toEqual([subjects.bassId]);
            expect(criterion?.range).toEqual({ sectionId: subjects.sectionId, startBeat: 0, endBeat: 4 });
            expect(criterion?.observed).toHaveLength(1);
            expect(criterion?.reference).toHaveLength(1);
            expect(Number.isFinite(criterion?.observed[0])).toBe(true);
            expect(Number.isFinite(criterion?.reference[0])).toBe(true);
            if (criterion === undefined) {
                throw new Error('The verified view must expose the actual measured criterion.');
            }
            await expect(page.getByText(criterion.criterionText, { exact: true })).toBeVisible();
            expect(evidence.state).toContain(subjects.sectionId);
            expect(
                evidence.receipts?.some(
                    (receipt) =>
                        receipt.toolName === 'analysis.measure' &&
                        receipt.status === 'success' &&
                        receipt.origin === 'application-verification'
                )
            ).toBe(true);
            expect(provider.requests).toHaveLength(3);
            await confirm.click();
            await expect
                .poll(() =>
                    page.evaluate(async (deviceId) => {
                        const arrangement: typeof import('../../src/modules/Arrangement/useCases') =
                            await import('/src/modules/Arrangement/useCases/index.ts');
                        return arrangement.getEligibleDeviceParameterValues(deviceId)?.['gain-level'];
                    }, subjects.deviceId)
                )
                .toBe(20 * Math.log10(0.5));
            await page.getByTestId('transport-undo').click();
            await expect
                .poll(() =>
                    page.evaluate(async (deviceId) => {
                        const arrangement: typeof import('../../src/modules/Arrangement/useCases') =
                            await import('/src/modules/Arrangement/useCases/index.ts');
                        return arrangement.getEligibleDeviceParameterValues(deviceId)?.['gain-level'];
                    }, subjects.deviceId)
                )
                .toBe(0);
        } finally {
            const terminal = await page.evaluate(async () => {
                const stores: typeof import('../../src/modules/AiRuntime/stores') =
                    await import('/src/modules/AiRuntime/stores/index.ts');
                const chat: typeof import('../../src/modules/AiRuntime/stores/chatStore') =
                    await import('/src/modules/AiRuntime/stores/chatStore.ts');
                return {
                    messages: chat.chatStore.value?.messages.map((message) => ({
                        id: message.id,
                        role: message.role,
                        content: message.content,
                        error: message.error,
                        confirmationId: message.pendingActionConfirmationId,
                    })),
                    runs: stores.agentRunStore.value?.runs.map((run) => ({
                        runId: run.runId,
                        phase: run.phase,
                        errors: run.errors,
                        plan: run.plan?.summary,
                    })),
                    confirmations: stores.pendingActionConfirmationStore.value?.confirmations.map((confirmation) => ({
                        id: confirmation.id,
                        status: confirmation.status,
                        error: confirmation.error,
                    })),
                };
            });
            await test
                .info()
                .attach('actual-agent-terminal', { body: JSON.stringify(terminal), contentType: 'application/json' });
            await test.info().attach('configured-provider-wire', {
                body: JSON.stringify({ failures: provider.failures, requests: provider.requests }),
                contentType: 'application/json',
            });
            await provider.close();
        }
    });
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { digest } from '#/utils/canonicalDigest';

import {
    BRIEF_ROUTE,
    DRUMS_ID,
    PROMPT,
    cardContent,
    renderTrack,
    requireOnlyProposedCard,
    resetVibeRunFixture,
    sendChatMessage,
    tearDownVibeRunFixture,
    type Confirmation,
    type RenderInput,
} from '../../__tests__/vibeRunWorkflowFixture';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { preflightVibeRunBatch } from '../agentRequestOrchestration/preflightVibeRunBatch';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME, buildVibeBatchValueRequest } from '../vibeRun/buildVibeBatchValueRequest';
import { chooseVibeBatchValues } from '../vibeRun/chooseVibeBatchValues';
import { describeCatalogueDefaultsReason } from '../vibeRun/describeCatalogueDefaultsReason';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * A vibe run asks the hosted provider for recipe values only on the tier it was planned and disclosed
 * under: the brief card's value-call line and the whole-run hosted token fit are decided once, at plan
 * time, so a backend switch between planning and Confirm must neither add nor drop provider calls.
 */
const runtimeMocks = vi.hoisted(() => ({ backend: { value: 'cloud' } }));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => [runtimeMocks.backend.value],
}));
vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => runtimeMocks.backend.value,
}));
vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));
vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(),
}));

const audio = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn(),
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
    updateDeviceParam: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...audio,
}));

const DRUMS_CHOICE = [
    { step: 0, paramId: 'eq-low-freq', value: 90 },
    { step: 0, paramId: 'eq-low-gain', value: 3.5 },
    { step: 0, paramId: 'eq-high-freq', value: 9000 },
    { step: 0, paramId: 'eq-high-gain', value: -1.5 },
];

/** Every value request the scripted provider received; the brief turns are scripted separately. */
const valueRequests: string[] = [];

function isValueRequest(schemas: readonly ToolSchema[]): boolean {
    return schemas.some((schema) => schema.function.name === VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME);
}

function scriptProvider(): void {
    let briefTurn = 0;
    vi.mocked(generateToolPlanningOutcome).mockImplementation((...args) => {
        const [, userMessage, schemas] = args;
        if (isValueRequest(schemas)) {
            valueRequests.push(userMessage);
            return Promise.resolve({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'values',
                        name: VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME,
                        arguments: {
                            choices: [{ targetId: DRUMS_ID, recipeId: 'drums-warm', values: DRUMS_CHOICE }],
                        },
                    },
                ],
            });
        }
        const turn = BRIEF_ROUTE[briefTurn];
        briefTurn += 1;
        if (turn === undefined) {
            return Promise.reject(new Error('Unscripted brief turn'));
        }
        return Promise.resolve({ status: 'complete', toolCalls: turn({ userMessage, schemas }) });
    });
}

async function planOn(backend: string): Promise<Confirmation> {
    scriptProvider();
    runtimeMocks.backend.value = backend;
    await sendChatMessage(PROMPT);
    return requireOnlyProposedCard();
}

async function confirmOn(card: Confirmation, backend: string): Promise<void> {
    runtimeMocks.backend.value = backend;
    await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({ status: 'executed' });
}

function expectCatalogueDefaults(card: Confirmation): void {
    expect(card.approvalSnapshot.adoptedRecipes).toEqual([
        expect.objectContaining({ recipeId: 'drums-warm', valueSource: 'catalogue-defaults' }),
    ]);
    expect(cardContent(card)).not.toContain('values chosen from measurements');
}

beforeEach(() => {
    resetVibeRunFixture(audio, runtimeMocks.backend);
    audio.renderTrackSubgraphOffline.mockImplementation((input: RenderInput) => Promise.resolve(renderTrack(input)));
    valueRequests.length = 0;
});

afterEach(() => {
    tearDownVibeRunFixture();
});

describe('the backend tier a vibe run was planned on', () => {
    // Red when a batch reads the live chain alone: the local plan disclosed no calls and never ran the token fit.
    it('asks no hosted provider when the run was planned locally and Confirm finds a hosted chain', async () => {
        const brief = await planOn('webllm');
        await confirmOn(brief, 'cloud');

        const card = requireOnlyProposedCard();
        expect(valueRequests).toEqual([]);
        expectCatalogueDefaults(card);
        expect(cardContent(card)).toContain('planned without hosted value calls');
    });

    // Red when a batch reads the live chain alone: the card promised a provider call the batch no longer makes silently.
    it('keeps the defaults with a stated reason when the run was planned hosted and Confirm finds a local chain', async () => {
        const brief = await planOn('cloud');
        await confirmOn(brief, 'webllm');

        const card = requireOnlyProposedCard();
        expect(valueRequests).toEqual([]);
        expectCatalogueDefaults(card);
        expect(cardContent(card)).toContain('the AI backend changed since this run was planned');
    });

    // Red when the planned tier stops reaching the batch, so a hosted plan on a hosted chain stops asking.
    it('asks the hosted provider once when the run was planned hosted and the chain is unchanged', async () => {
        const brief = await planOn('cloud');
        await confirmOn(brief, 'cloud');

        const card = requireOnlyProposedCard();
        expect(valueRequests).toHaveLength(1);
        expect(card.approvalSnapshot.adoptedRecipes).toEqual([
            expect.objectContaining({ recipeId: 'drums-warm', valueSource: 'measurements' }),
        ]);
    });

    // Red when a stored plan with no recorded tier is read as hosted on a hosted chain, or when the
    // reader stops binding the tier to the plan digest.
    describe('a stored plan', () => {
        async function storedPlan() {
            const brief = await planOn('cloud');
            await confirmOn(brief, 'cloud');
            const run = agentRunLifecycle.get(brief.runId);
            const schedule = run?.plan?.batchSchedule;
            if (run === null || schedule?.kind !== 'vibe-run') {
                throw new TypeError('Expected the vibe run and its schedule');
            }
            const stored = readScheduledVibeRunPlan(schedule.serializedPlan);
            if (stored === null || stored.schemaVersion !== 2) {
                throw new TypeError('Expected a measured stored plan');
            }
            return { run, schedule, stored };
        }

        it('records the tier it was planned under', async () => {
            const { stored } = await storedPlan();
            expect(stored.valueChoiceTier).toBe('hosted');
        });

        it('is rejected when its tier is changed after planning', async () => {
            const { stored } = await storedPlan();
            const flipped = JSON.stringify({ ...stored, valueChoiceTier: 'local' });
            expect(readScheduledVibeRunPlan(flipped)).toBeNull();
        });

        /** The pre-tier plan as an older build stored it: no tier, sealed by the digest formula it used. */
        async function legacyPlan() {
            const { run, schedule, stored } = await storedPlan();
            const { valueChoiceTier: _recorded, ...rest } = stored;
            const legacy = {
                ...rest,
                planDigest: digest({
                    briefRevision: stored.briefRevision,
                    batches: stored.batches,
                    initialDigest: stored.initialDigest,
                }),
            };
            return { run, older: { ...schedule, serializedPlan: JSON.stringify(legacy) } };
        }

        it('with no recorded tier and its original digest still reads, and its tier is unrecorded', async () => {
            const { run, older } = await legacyPlan();
            expect(readScheduledVibeRunPlan(older.serializedPlan)).not.toBeNull();
            expect(preflightVibeRunBatch(run, older, 2)).toMatchObject({
                status: 'admitted',
                valueChoiceTier: 'unrecorded',
            });
        });

        it('with no recorded tier asks no hosted provider on a hosted chain and says why', async () => {
            const { run, older } = await legacyPlan();
            const preflight = preflightVibeRunBatch(run, older, 2);
            if (preflight.status !== 'admitted') {
                throw new TypeError('Expected the legacy batch to be admitted');
            }
            const built = buildVibeBatchValueRequest(preflight);
            if (built.status === 'refused') {
                throw new TypeError(built.reason);
            }
            valueRequests.length = 0;
            const choice = await chooseVibeBatchValues({
                runId: run.runId,
                request: built.request,
                plannedTier: preflight.valueChoiceTier,
            });
            expect(valueRequests).toEqual([]);
            if (choice.source !== 'catalogue-defaults') {
                throw new TypeError('Expected catalogue defaults');
            }
            const line = describeCatalogueDefaultsReason(choice.reason, choice.detail);
            expect(line).toContain('planned before its value tier was recorded');
            expect(line).not.toContain('the AI backend changed');
        });
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { undoHistoryStore } from '#/modules/Command/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { captureProjectRevision, settlePendingProjectWritesAndCaptureRevision } from '#/modules/CrdtDocument/useCases';

import {
    BASS_ID,
    BRIEF_REVISION,
    DRUMS_ID,
    VOCAL_ID,
    briefIntake,
    cardContent,
    editBrief,
    liveBriefRevision,
    proposeBrief,
    proposedCards,
    renderTrack,
    requireOnlyProposedCard,
    resetVibeRunFixture,
    scriptPlanningTurns,
    sendChatMessage,
    tearDownVibeRunFixture,
    trackDeviceTypes,
    type Confirmation,
    type ScriptedPlanningTurn,
} from '../../__tests__/vibeRunWorkflowFixture';
import { type BriefReading } from '../../models/BriefReading';
import { type ProjectContextProductionBrief } from '../../models/ProjectContext';
import { chatStore } from '../../stores/chatStore';
import {
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { pendingActionResourceSettlement } from '../agentRequestOrchestration/pendingActionResourceSettlement';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';
import { agentRunCancellation } from '../cancelAgentRun';
import { chooseVibeBriefReading } from '../chooseVibeBriefReading';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { executeBriefCompile } from '../executeBriefCompile';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getBriefMixIntentCatalog } from '../getBriefMixIntentCatalog';
import { getProjectContext } from '../getProjectContext';
import { readBriefMixIntent } from '../readBriefMixIntent';
import { planVibeRunSchedule } from '../vibeRun/planVibeRunSchedule';
import { prepareVibeRunSchedule } from '../vibeRun/prepareVibeRunSchedule';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * A request whose characters admit more than one reading puts the readings on its brief card and
 * plans nothing; choosing one plans exactly that reading in the same run, with no provider turn.
 */
const runtimeMocks = vi.hoisted(() => ({ backend: { value: 'cloud' } }));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => [runtimeMocks.backend.value],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => runtimeMocks.backend.value,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: () => ({ provider: 'openai', model: 'hosted-model', baseUrl: 'https://api.openai.com/v1' }),
}));

vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(async () => {
        throw new Error('Unscripted provider planning request.');
    }),
}));

const audio = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn(),
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...audio,
}));

beforeEach(() => {
    resetVibeRunFixture(audio, runtimeMocks.backend);
});

afterEach(() => {
    tearDownVibeRunFixture();
});

const AMBIGUOUS_PROMPT = 'make this mix warmer';
const THREE_READINGS = [
    { name: 'Darker top end', requestedDescriptors: ['dark'] },
    { name: 'More low-mid body', requestedDescriptors: ['warm'] },
    { name: 'Gentle saturation', requestedDescriptors: ['vintage', 'warm'] },
];
const PROTECTIVE_CLAUSE = 'keep it warm';

function mixIntentWith(alternatives: unknown, requestedDescriptors: readonly string[] = []) {
    return { catalogId: getBriefMixIntentCatalog().catalogId, requestedDescriptors, alternatives };
}

function compileTurn(mixIntent: unknown): ScriptedPlanningTurn {
    return () => [
        {
            id: 'brief-compile',
            name: 'brief.compile',
            arguments: { vision: 'A warmer mix', mixIntent },
        },
    ];
}

/** Sends the request through the scripted brief route and returns the one card it proposes. */
async function ask(
    mixIntent: unknown,
    prompt = AMBIGUOUS_PROMPT
): Promise<{ card: Confirmation; providerTurns: () => number }> {
    const requests = scriptPlanningTurns([briefIntake, compileTurn(mixIntent), proposeBrief]);
    await sendChatMessage(prompt);
    return { card: requireOnlyProposedCard(), providerTurns: () => requests.length };
}

function readingsOf(card: Confirmation) {
    return card.approvalSnapshot.briefReadings?.readings ?? [];
}

function readingIdOf(card: Confirmation, name: string): string {
    const reading = readingsOf(card).find((candidate) => candidate.name === name);
    if (reading === undefined) {
        throw new TypeError(`Expected the card to offer a reading named ${name}`);
    }
    return reading.id;
}

function scheduledDescriptors(runId: string): string[][] {
    const schedule = agentRunLifecycle.get(runId)?.plan?.batchSchedule;
    if (schedule?.kind !== 'vibe-run') {
        return [];
    }
    const plan: { batches: { objective: { descriptors: string[] } }[] } = JSON.parse(schedule.serializedPlan);
    return plan.batches.map((batch) => batch.objective.descriptors);
}

/** A live run the way the loop holds one while it calls `brief.compile`. */
function createLiveRun(limits: Record<string, number> = {}): string {
    const runId = `run-${crypto.randomUUID()}`;
    agentRunLifecycle.create({
        runId,
        request: AMBIGUOUS_PROMPT,
        mode: 'macro',
        createdRevision: captureProjectRevision(),
        budgets: { limits, consumed: {} },
    });
    return runId;
}

/** What the pre-measurement stage plans for these characters on the live project: the plan a reading must retain. */
function preparedFor(runId: string, brief: ProjectContextProductionBrief, descriptors: readonly string[]) {
    const mixIntent = readBriefMixIntent({
        catalogId: getBriefMixIntentCatalog().catalogId,
        requestedDescriptors: descriptors,
    });
    if (mixIntent === null) {
        throw new TypeError('Expected the characters to be a selection from the live catalogue');
    }
    const prepared = prepareVibeRunSchedule({
        prompt: AMBIGUOUS_PROMPT,
        context: getProjectContext(),
        brief,
        mixIntent,
        runId,
        priorReceipts: agentRunLifecycle.get(runId)?.plan?.applicationToolReceipts ?? [],
    });
    if (prepared.status !== 'prepared') {
        throw new TypeError(`Expected ${descriptors.join(', ')} to prepare a plan, got ${prepared.status}`);
    }
    return prepared;
}

type PlanBatchShape = { targetIds: readonly string[]; commandCount: number; targets: readonly unknown[] };

/** The batches' targets, recipes, expected deltas and command counts: what a plan stands for. */
function planShape(batches: readonly PlanBatchShape[]) {
    return batches.map(({ targetIds, commandCount, targets }) => ({ targetIds, commandCount, targets }));
}

function requireOffer(card: Confirmation) {
    const offer = card.approvalSnapshot.briefReadings;
    if (offer === undefined) {
        throw new TypeError('Expected the card to offer readings');
    }
    return offer;
}

describe('a brief request whose characters admit more than one reading', () => {
    it.each([
        ['two readings', THREE_READINGS.slice(0, 2)],
        ['three readings', THREE_READINGS],
    ])('offers %s on the brief card and plans and measures nothing', async (_label, alternatives) => {
        const { card, providerTurns } = await ask(mixIntentWith(alternatives));

        expect(readingsOf(card).map(({ name, descriptors }) => ({ name, descriptors }))).toEqual(
            alternatives.map(({ name, requestedDescriptors }) => ({ name, descriptors: requestedDescriptors }))
        );
        expect(new Set(readingsOf(card).map((reading) => reading.id)).size).toBe(alternatives.length);
        expect(card.actions.map((action) => action.type)).toEqual(['setProductionBrief']);
        const run = agentRunLifecycle.get(card.runId);
        expect(run?.plan?.batchSchedule).toBeUndefined();
        expect(card.approvalSnapshot.batchPosition).toBeUndefined();
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(audio.renderOffline).not.toHaveBeenCalled();
        expect(providerTurns()).toBe(3);
        expect(liveBriefRevision()).toBe(BRIEF_REVISION);
        const content = cardContent(card);
        for (const { name, requestedDescriptors } of alternatives) {
            expect(content.split('\n')).toContain(`- ${name}: ${requestedDescriptors.join(', ')}`);
        }
        expect(content).toMatch(/more than one way/u);
        expect(getAgentApprovalView({ confirmationId: card.id })?.readings.map((reading) => reading.name)).toEqual(
            alternatives.map(({ name }) => name)
        );
    });

    it('retains, on each reading, exactly the plan the pre-measurement stage makes for its characters', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        const offer = requireOffer(card);

        for (const reading of offer.readings) {
            const expected = preparedFor(card.runId, offer.brief, reading.descriptors);
            expect(reading.plan.batches.length).toBeGreaterThan(0);
            expect(reading.plan.planDigest).toBe(expected.planDigest);
            expect(planShape(reading.plan.batches)).toEqual(planShape(expected.batches));
        }
        const view = getAgentApprovalView({ confirmationId: card.id })?.readings ?? [];
        expect(view.map((reading) => reading.name)).toEqual(THREE_READINGS.map(({ name }) => name));
        for (const [position, reading] of offer.readings.entries()) {
            const lines = view[position]?.planLines ?? [];
            expect(lines[0]).toMatch(/^Batch 2 of \d+: /u);
            for (const trackId of reading.plan.batches.flatMap((batch) => batch.targetIds)) {
                const trackName = reading.plan.trackNames[trackId] ?? trackId;
                expect(lines.some((line) => line.startsWith(`${trackName}: `))).toBe(true);
            }
        }
        const [first, second] = offer.readings;
        expect(planShape(first?.plan.batches ?? [])).not.toEqual(planShape(second?.plan.batches ?? []));
        expect(first?.plan.planDigest).not.toBe(second?.plan.planDigest);
    });

    it('is inert: offering the readings renders, measures, reserves and writes nothing, and asks no provider', async () => {
        const revision = captureProjectRevision();
        const history = structuredClone(undoHistoryStore.value);
        const { card, providerTurns } = await ask(mixIntentWith(THREE_READINGS));

        expect(readingsOf(card)).toHaveLength(3);
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(audio.renderOffline).not.toHaveBeenCalled();
        expect(audio.renderOfflineInput).not.toHaveBeenCalled();
        // The brief turn is the only provider traffic: intake, compile, propose.
        expect(providerTurns()).toBe(3);
        const consumed = agentRunLifecycle.get(card.runId)?.budgets.consumed ?? {};
        expect(consumed.maxRenderJobs ?? 0).toBe(0);
        expect(consumed.localAnalysis ?? 0).toBe(0);
        expect(agentRunLifecycle.get(card.runId)?.plan?.applicationToolReceipts?.map((r) => r.origin)).not.toContain(
            'application-verification'
        );
        expect(captureProjectRevision()).toBe(revision);
        expect(undoHistoryStore.value).toEqual(history);
        expect(liveBriefRevision()).toBe(BRIEF_REVISION);
    });

    it('records only the brief when Confirm is chosen over every reading, and plans no batch', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));

        await expect(confirmPendingChatActions({ confirmationId: card.id })).resolves.toEqual({ status: 'executed' });

        expect(liveBriefRevision()).toBe(BRIEF_REVISION + 1);
        expect(proposedCards()).toEqual([]);
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });
});

describe('an unambiguous brief request', () => {
    it.each([
        ['no alternatives key', undefined],
        ['null alternatives', null],
        ['an empty alternatives list', []],
    ])('offers no reading and plans directly with %s', async (_label, alternatives) => {
        const mixIntent = { catalogId: getBriefMixIntentCatalog().catalogId, requestedDescriptors: ['warm'] };
        const { card } = await ask(alternatives === undefined ? mixIntent : { ...mixIntent, alternatives });

        expect(card.approvalSnapshot.briefReadings).toBeUndefined();
        expect(getAgentApprovalView({ confirmationId: card.id })?.readings).toEqual([]);
        expect(card.approvalSnapshot.batchPosition).toEqual({ index: 1, total: 4 });
        expect(scheduledDescriptors(card.runId)).toEqual([['warm'], ['warm'], ['warm']]);
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalled();
    });
});

describe('the rules a reading list must meet', () => {
    function compileWith(mixIntent: unknown, prompt = AMBIGUOUS_PROMPT, sourceRunId: string | null = createLiveRun()) {
        return executeBriefCompile({
            call: { id: 'brief-compile', name: 'brief.compile', arguments: { vision: 'A warmer mix', mixIntent } },
            callId: 'brief-compile',
            turn: 2,
            revision: captureProjectRevision(),
            prompt,
            context: getProjectContext(),
            sourceRunId,
            isBriefOffered: true,
            isBriefRequested: () => true,
        });
    }

    it('accepts two valid readings, keeping the mix intent two-key', () => {
        const runId = createLiveRun();
        const result = compileWith(mixIntentWith(THREE_READINGS.slice(0, 2)), AMBIGUOUS_PROMPT, runId);

        expect(result.receipt.status).toBe('success');
        expect(result.mixIntent).toEqual({ catalogId: getBriefMixIntentCatalog().catalogId, requestedDescriptors: [] });
        expect(
            result.mixAlternatives?.map(({ name, requestedDescriptors }) => ({ name, requestedDescriptors }))
        ).toEqual(THREE_READINGS.slice(0, 2));
        const brief = result.composedBrief;
        if (brief === null) {
            throw new TypeError('Expected a composed brief');
        }
        for (const alternative of result.mixAlternatives ?? []) {
            const expected = preparedFor(runId, brief, alternative.requestedDescriptors);
            expect(alternative.plan.planDigest).toBe(expected.planDigest);
            expect(planShape(alternative.plan.batches)).toEqual(planShape(expected.batches));
        }
    });

    it('offers no reading to a request without a live run, as a correctable failure', () => {
        for (const sourceRunId of [null, 'run-that-does-not-exist']) {
            const result = compileWith(mixIntentWith(THREE_READINGS.slice(0, 2)), AMBIGUOUS_PROMPT, sourceRunId);

            expect(result.commands).toBeNull();
            expect(result.mixAlternatives).toBeUndefined();
            expect(result.receipt).toMatchObject({
                status: 'failure',
                error: { code: 'invalid-tool-arguments', retryable: true },
            });
            expect(result.receipt.error?.safeMessage).toMatch(/no live run/u);
        }
    });

    it('refuses a reading whose plan does not fit the run, naming the reading and the budget', () => {
        const result = compileWith(
            mixIntentWith(THREE_READINGS.slice(0, 2)),
            AMBIGUOUS_PROMPT,
            createLiveRun({ maxRenderJobs: 1 })
        );

        expect(result.commands).toBeNull();
        expect(result.mixAlternatives).toBeUndefined();
        expect(result.receipt).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-tool-arguments', retryable: true },
        });
        expect(result.receipt.error?.safeMessage).toMatch(/"Darker top end".*maxRenderJobs/u);
    });

    it.each([
        [
            'a fourth reading',
            mixIntentWith([...THREE_READINGS, { name: 'More air', requestedDescriptors: ['airy'] }]),
            /at most three/u,
        ],
        [
            'exactly one reading',
            mixIntentWith(THREE_READINGS.slice(0, 1)),
            /single reading belongs in requestedDescriptors/u,
        ],
        [
            'readings beside requested descriptors',
            mixIntentWith(THREE_READINGS.slice(0, 2), ['warm']),
            /requestedDescriptors must be empty/u,
        ],
        [
            'duplicate names, compared trimmed and case-insensitively',
            mixIntentWith([
                { name: 'Darker top end', requestedDescriptors: ['dark'] },
                { name: '  darker TOP end ', requestedDescriptors: ['warm'] },
            ]),
            /same name/u,
        ],
        [
            'a blank name',
            mixIntentWith([
                { name: '   ', requestedDescriptors: ['dark'] },
                { name: 'Body', requestedDescriptors: ['warm'] },
            ]),
            /needs a name/u,
        ],
        [
            'two readings with the same characters',
            mixIntentWith([
                { name: 'First', requestedDescriptors: ['warm', 'dark'] },
                { name: 'Second', requestedDescriptors: ['dark', 'warm'] },
            ]),
            /same characters/u,
        ],
        [
            'an unknown descriptor',
            mixIntentWith([
                { name: 'First', requestedDescriptors: ['sparkly'] },
                { name: 'Second', requestedDescriptors: ['warm'] },
            ]),
            /unknown character "sparkly"/u,
        ],
        [
            'a repeated descriptor inside one reading',
            mixIntentWith([
                { name: 'First', requestedDescriptors: ['warm', 'warm'] },
                { name: 'Second', requestedDescriptors: ['dark'] },
            ]),
            /repeats a character/u,
        ],
        [
            'an empty descriptor list',
            mixIntentWith([
                { name: 'First', requestedDescriptors: [] },
                { name: 'Second', requestedDescriptors: ['warm'] },
            ]),
            /at least one character/u,
        ],
        ['a reading that is not an object', mixIntentWith(['warm', 'dark']), /name and requestedDescriptors/u],
        ['an alternatives value that is not a list', mixIntentWith('warm or dark'), /list of readings/u],
    ])('refuses %s as a correctable failure naming the rule', (_label, mixIntent, rule) => {
        const result = compileWith(mixIntent);

        expect(result.commands).toBeNull();
        expect(result.mixAlternatives).toBeUndefined();
        expect(result.receipt).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-tool-arguments', retryable: true },
        });
        expect(result.receipt.error?.safeMessage).toMatch(rule);
    });

    it('refuses a reading no authored recipe plans on this project, naming it', () => {
        // Every track is protected, so no recipe has a target left to serve: the same candidate
        // step a vibe run begins with yields no batch for any reading.
        const serving = compileWith(
            mixIntentWith([
                { name: 'Body', requestedDescriptors: ['warm'] },
                { name: 'Top', requestedDescriptors: ['dark'] },
            ])
        );
        expect(serving.receipt.status).toBe('success');

        const result = compileWith(
            mixIntentWith([
                { name: 'Nothing here', requestedDescriptors: ['dark'] },
                { name: 'Body', requestedDescriptors: ['warm'] },
            ]),
            'make this mix warmer but leave the Drums, the Vocal and the Bass alone'
        );

        expect(result.commands).toBeNull();
        expect(result.receipt).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-tool-arguments', retryable: true },
        });
        expect(result.receipt.error?.safeMessage).toMatch(/"Nothing here".*no authored recipe that plans/u);
    });
});

describe('choosing one reading of the brief card', () => {
    it.each([
        ['the first reading', 'Darker top end', ['dark']],
        ['the second reading', 'More low-mid body', ['warm']],
        ['the last reading, which stands for two characters', 'Gentle saturation', ['vintage', 'warm']],
    ])('plans exactly %s in the same run, with no provider turn', async (_label, name, descriptors) => {
        const { card, providerTurns } = await ask(mixIntentWith(THREE_READINGS));
        const turnsBefore = providerTurns();

        await expect(
            chooseVibeBriefReading({ confirmationId: card.id, readingId: readingIdOf(card, name) })
        ).resolves.toEqual({ status: 'chosen' });

        expect(providerTurns()).toBe(turnsBefore);
        const replacement = requireOnlyProposedCard();
        expect(replacement.id).not.toBe(card.id);
        expect(replacement.runId).toBe(card.runId);
        expect(replacement.supersedes).toBe(card.id);
        expect(getPendingActionConfirmation(card.id)).toMatchObject({
            status: 'invalidated',
            supersededBy: replacement.id,
        });
        expect(replacement.approvalSnapshot.briefReadings).toBeUndefined();
        expect(replacement.actions).toEqual(card.actions);
        expect(replacement.approvalSnapshot.batchPosition?.index).toBe(1);
        const planned = scheduledDescriptors(card.runId);
        expect(planned.length).toBeGreaterThan(0);
        // The planner states a batch's characters in its own order; the set is the reading's.
        expect(planned.map((batch) => batch.toSorted())).toEqual(planned.map(() => descriptors.toSorted()));
        expect(cardContent(replacement)).toContain(`Reading chosen: ${name}`);
        expect(agentRunLifecycle.get(card.runId)?.phase).toBe('waiting-for-approval');
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalled();
        expect(getAgentApprovalView({ confirmationId: replacement.id })?.readings).toEqual([]);
        // The replaced card offers nothing to choose any more, though it still holds its readings.
        expect(getPendingActionConfirmation(card.id)?.approvalSnapshot.briefReadings?.readings).toHaveLength(3);
        expect(getAgentApprovalView({ confirmationId: card.id })?.readings).toEqual([]);
    });

    it.each([
        ['the first reading', 'Darker top end'],
        ['the last reading', 'Gentle saturation'],
    ])(
        'runs exactly the plan retained on %s: the same targets, recipes, deltas and counts, with no provider turn',
        async (_label, name) => {
            const { card, providerTurns } = await ask(mixIntentWith(THREE_READINGS));
            const retained = readingsOf(card).find((candidate) => candidate.name === name)?.plan;
            const turnsBefore = providerTurns();

            await chooseVibeBriefReading({ confirmationId: card.id, readingId: readingIdOf(card, name) });

            const schedule = agentRunLifecycle.get(card.runId)?.plan?.batchSchedule;
            if (schedule?.kind !== 'vibe-run' || retained === undefined) {
                throw new TypeError('Expected the chosen reading to schedule a vibe run');
            }
            const scheduled: { batches: PlanBatchShape[] } = JSON.parse(schedule.serializedPlan);
            expect(retained.batches.length).toBeGreaterThan(0);
            expect(planShape(scheduled.batches)).toEqual(planShape(retained.batches));
            expect(providerTurns()).toBe(turnsBefore);
        }
    );

    it('records the chosen reading under the provider proposal the readings card was planned with', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        // The card carries the proposal its own planning recorded; a distinct one shows which the plan reads.
        pendingActionConfirmationStore.set({
            confirmations: (pendingActionConfirmationStore.value?.confirmations ?? []).map(
                withSeededPlan(card.id, { providerProposal: SEEDED_PROPOSAL })
            ),
        });

        await chooseVibeBriefReading({ confirmationId: card.id, readingId: readingIdOf(card, 'Darker top end') });

        const chosen = agentRunLifecycle.get(card.runId)?.plan;
        expect(chosen?.objective).toBe(SEEDED_PROPOSAL.objective);
        expect(chosen?.validationStrategy).toContain(SEEDED_PROPOSAL.validationStrategy[0]);
    });

    it('plans the chosen reading under the terminal settlement the readings card was planned with', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        // A settlement must match its intake and receipts, so one that does not is refused only if the plan reads it.
        pendingActionConfirmationStore.set({
            confirmations: (pendingActionConfirmationStore.value?.confirmations ?? []).map(
                withSeededPlan(card.id, { terminalMeasurementSettlement: SEEDED_SETTLEMENT })
            ),
        });

        const outcome = await chooseVibeBriefReading({
            confirmationId: card.id,
            readingId: readingIdOf(card, 'Darker top end'),
        });

        expect(outcome).toMatchObject({
            status: 'refused',
            reason: expect.stringMatching(/Terminal measurement settlement does not match/u),
        });
    });

    it('confirms the replacement card as the brief, then proposes the first batch of the chosen reading', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        await chooseVibeBriefReading({ confirmationId: card.id, readingId: readingIdOf(card, 'Gentle saturation') });
        const replacement = requireOnlyProposedCard();

        await expect(confirmPendingChatActions({ confirmationId: replacement.id })).resolves.toEqual({
            status: 'executed',
        });

        expect(liveBriefRevision()).toBe(BRIEF_REVISION + 1);
        const batch = requireOnlyProposedCard();
        expect(batch.approvalSnapshot.batchPosition?.index).toBe(2);
        const recipeCharacters = (batch.approvalSnapshot.adoptedRecipes ?? []).map((recipe) =>
            recipe.recipeId.replace(/^[^-]+-/u, '')
        );
        expect(recipeCharacters.toSorted()).toEqual(['vintage', 'warm']);
    });

    it('applies nothing: the brief, devices, undo history and revision are as they were', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        const revision = captureProjectRevision();
        const history = structuredClone(undoHistoryStore.value);

        await chooseVibeBriefReading({ confirmationId: card.id, readingId: readingIdOf(card, 'More low-mid body') });

        expect(liveBriefRevision()).toBe(BRIEF_REVISION);
        for (const trackId of [DRUMS_ID, VOCAL_ID, BASS_ID]) {
            expect(trackDeviceTypes(trackId)).toEqual([]);
        }
        expect(captureProjectRevision()).toBe(revision);
        expect(undoHistoryStore.value).toEqual(history);
        expect(agentRunLifecycle.get(card.runId)?.receipts).toEqual([]);
    });

    it('still quotes a protective clause nothing measures on the replacement card', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS), `make this mix more open but ${PROTECTIVE_CLAUSE}`);
        const notMeasured = (confirmation: Confirmation) =>
            cardContent(confirmation)
                .split('\n')
                .filter((line) => line.startsWith('Not measured:'));
        expect(notMeasured(card)).toEqual([
            `Not measured: “${PROTECTIVE_CLAUSE}” — nothing the application measures shows that it holds.`,
        ]);

        const quotedOnTheOfferingCard = notMeasured(card);
        await chooseVibeBriefReading({ confirmationId: card.id, readingId: readingIdOf(card, 'Darker top end') });

        expect(notMeasured(requireOnlyProposedCard())).toEqual(quotedOnTheOfferingCard);
    });
});

const SEEDED_SETTLEMENT = 'seeded-terminal-measurement-settlement';

const SEEDED_PROPOSAL = {
    semantic: { classification: 'simple' as const, uncertainty: [] },
    objective: 'Seeded provider objective',
    constraints: [],
    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    capabilityIds: [],
    assetIds: [],
    alternatives: [],
    validationStrategy: ['Seeded validation step.'],
    stoppingConditions: [],
};

/** The card as if its request had been planned with a provider proposal or a terminal measurement settlement. */
function withSeededPlan(
    cardId: string,
    seed: { providerProposal?: typeof SEEDED_PROPOSAL; terminalMeasurementSettlement?: string }
) {
    return (confirmation: Confirmation): Confirmation => {
        const readings = confirmation.approvalSnapshot.briefReadings;
        if (confirmation.id !== cardId || readings === undefined) {
            return confirmation;
        }
        return {
            ...confirmation,
            approvalSnapshot: {
                ...confirmation.approvalSnapshot,
                briefReadings: { ...readings, ...seed },
            },
        };
    };
}

/** The card with one reading's retained plan replaced, as if it had been prepared against another project. */
function withRetainedPlan(cardId: string, readingName: string, change: (reading: BriefReading) => BriefReading) {
    return (confirmation: Confirmation): Confirmation => {
        const readings = confirmation.approvalSnapshot.briefReadings;
        if (confirmation.id !== cardId || readings === undefined) {
            return confirmation;
        }
        return {
            ...confirmation,
            approvalSnapshot: {
                ...confirmation.approvalSnapshot,
                briefReadings: {
                    ...readings,
                    readings: readings.readings.map((reading) =>
                        reading.name === readingName ? change(reading) : reading
                    ),
                },
            },
        };
    };
}

/** The card as it would read if the mix catalogue had changed after the card was made. */
function withOldCatalog(cardId: string) {
    return (confirmation: Confirmation): Confirmation => {
        const readings = confirmation.approvalSnapshot.briefReadings;
        if (confirmation.id !== cardId || readings === undefined) {
            return confirmation;
        }
        return {
            ...confirmation,
            approvalSnapshot: {
                ...confirmation.approvalSnapshot,
                briefReadings: { ...readings, catalogId: 'old-catalog' },
            },
        };
    };
}

describe('a chosen reading that cannot be planned once its card is retired', () => {
    function planningMessage() {
        return (chatStore.value?.messages ?? []).findLast((message) =>
            message.content.startsWith('No plan was made for the reading')
        );
    }

    async function chooseDarker() {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        const outcome = await chooseVibeBriefReading({
            confirmationId: card.id,
            readingId: readingIdOf(card, 'Darker top end'),
        });
        return { card, outcome };
    }

    it('ends the run as failed, with no card and a message saying so, when the project changes while it measures', async () => {
        let edited = false;
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: Parameters<typeof renderTrack>[0]) => {
            if (!edited) {
                edited = true;
                await editBrief();
            }
            return renderTrack(input);
        });

        const { card, outcome } = await chooseDarker();

        expect(edited).toBe(true);
        expect(outcome).toMatchObject({ status: 'refused', reason: expect.stringMatching(/project or run changed/u) });
        expect(agentRunLifecycle.get(card.runId)?.phase).toBe('failed');
        expect(proposedCards()).toEqual([]);
        expect(planningMessage()?.content).toMatch(/No plan was made for the reading "Darker top end"/u);
        expect(planningMessage()?.stoppableRunId).toBeUndefined();
    });

    it('leaves a stopped reading cancelled, with no recorded error, when Stop lands while it measures', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        const errorsBefore = agentRunLifecycle.get(card.runId)?.errors.length;
        audio.renderTrackSubgraphOffline.mockImplementation(async (input: Parameters<typeof renderTrack>[0]) => {
            void agentRunCancellation.cancel({ runId: card.runId, reason: 'Cancelled by user' });
            await Promise.resolve();
            return renderTrack(input);
        });

        const outcome = await chooseVibeBriefReading({
            confirmationId: card.id,
            readingId: readingIdOf(card, 'Darker top end'),
        });

        expect(outcome.status).toBe('refused');
        const run = agentRunLifecycle.get(card.runId);
        expect(run?.phase).toBe('cancelled');
        expect(run?.errors).toHaveLength(errorsBefore ?? -1);
        expect(proposedCards()).toEqual([]);
        const stopped = (chatStore.value?.messages ?? []).findLast((message) =>
            message.content.includes('planning the reading "Darker top end"')
        );
        expect(stopped?.content).toMatch(/^(Cancelled|Stopped) planning the reading/u);
        expect(stopped?.stoppableRunId).toBeUndefined();
        expect(planningMessage()).toBeUndefined();
    });

    it('returns refused, never throws, and ends the run as failed when planning throws', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        vi.spyOn(agentWorkBudget, 'admitMeasurement').mockImplementation(() => {
            throw new Error('the measurement budget is unavailable');
        });

        const outcome = await chooseVibeBriefReading({
            confirmationId: card.id,
            readingId: readingIdOf(card, 'Darker top end'),
        });

        expect(outcome).toMatchObject({ status: 'refused', reason: expect.stringMatching(/budget is unavailable/u) });
        expect(agentRunLifecycle.get(card.runId)?.phase).toBe('failed');
        expect(proposedCards()).toEqual([]);
        expect(planningMessage()?.content).toMatch(/No plan was made for the reading "Darker top end"/u);
    });
});

describe('a choice that no longer applies', () => {
    function snapshotOf(card: Confirmation) {
        return {
            card: getPendingActionConfirmation(card.id),
            run: agentRunLifecycle.get(card.runId),
            messages: structuredClone(chatStore.value?.messages),
        };
    }

    it('refuses a second choice on the card the first choice superseded, leaving the replacement alone', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        await chooseVibeBriefReading({ confirmationId: card.id, readingId: readingIdOf(card, 'Darker top end') });
        const replacement = requireOnlyProposedCard();
        const before = snapshotOf(replacement);
        const renders = audio.renderTrackSubgraphOffline.mock.calls.length;

        await expect(
            chooseVibeBriefReading({ confirmationId: card.id, readingId: readingIdOf(card, 'More low-mid body') })
        ).resolves.toEqual({ status: 'not_pending', currentStatus: 'invalidated' });

        expect(snapshotOf(replacement)).toEqual(before);
        expect(audio.renderTrackSubgraphOffline.mock.calls.length).toBe(renders);
    });

    it('refuses a choice once the production brief moved, leaving the card and run unchanged', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        await editBrief();
        const before = snapshotOf(card);

        const outcome = await chooseVibeBriefReading({
            confirmationId: card.id,
            readingId: readingIdOf(card, 'Darker top end'),
        });

        expect(outcome).toMatchObject({
            status: 'refused',
            reason: expect.stringMatching(/production brief changed/u),
        });
        expect(snapshotOf(card)).toEqual(before);
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it('refuses a reading id the card does not offer, leaving the card and run unchanged', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        const before = snapshotOf(card);

        const outcome = await chooseVibeBriefReading({ confirmationId: card.id, readingId: 'reading-9' });

        expect(outcome).toMatchObject({ status: 'refused', reason: expect.stringMatching(/offers no reading/u) });
        expect(snapshotOf(card)).toEqual(before);
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it('refuses a choice after the catalogue changed, leaving the card and run unchanged', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        pendingActionConfirmationStore.set({
            confirmations: (pendingActionConfirmationStore.value?.confirmations ?? []).map(withOldCatalog(card.id)),
        });
        const before = snapshotOf(card);

        const outcome = await chooseVibeBriefReading({
            confirmationId: card.id,
            readingId: readingIdOf(card, 'Darker top end'),
        });

        expect(outcome).toMatchObject({ status: 'refused', reason: expect.stringMatching(/catalogue changed/u) });
        expect(snapshotOf(card)).toEqual(before);
    });

    it('refuses a choice once the run has ended, and a card that does not exist', async () => {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        agentRunLifecycle.transitionPhase({ runId: card.runId, phase: 'cancelled' });

        await expect(
            chooseVibeBriefReading({ confirmationId: card.id, readingId: readingIdOf(card, 'Darker top end') })
        ).resolves.toMatchObject({ status: 'refused', reason: expect.stringMatching(/run .* has ended/u) });
        await expect(
            chooseVibeBriefReading({ confirmationId: 'no-such-card', readingId: 'reading-1' })
        ).resolves.toEqual({ status: 'missing' });
    });

    describe('whose retained plan no longer holds', () => {
        const READING = 'Darker top end';

        /** Chooses the reading and checks that the card, run and renders are as they were; returns the outcome. */
        async function chooseLeavingUntouched(card: Confirmation) {
            const before = snapshotOf(card);
            const renders = audio.renderTrackSubgraphOffline.mock.calls.length;

            const outcome = await chooseVibeBriefReading({
                confirmationId: card.id,
                readingId: readingIdOf(card, READING),
            });

            expect(snapshotOf(card)).toEqual(before);
            expect(getPendingActionConfirmation(card.id)?.status).toBe('proposed');
            expect(agentRunLifecycle.get(card.runId)?.phase).toBe(before.run?.phase);
            expect(audio.renderTrackSubgraphOffline.mock.calls.length).toBe(renders);
            expect(proposedCards().map((candidate) => candidate.id)).toEqual([card.id]);
            return outcome;
        }

        it('refuses a recipe the live catalogue no longer publishes, naming it', async () => {
            const { card } = await ask(mixIntentWith(THREE_READINGS));
            pendingActionConfirmationStore.set({
                confirmations: (pendingActionConfirmationStore.value?.confirmations ?? []).map(
                    withRetainedPlan(card.id, READING, (reading) => ({
                        ...reading,
                        plan: {
                            ...reading.plan,
                            batches: reading.plan.batches.map((batch) => ({
                                ...batch,
                                targets: batch.targets.map((target) => ({
                                    ...target,
                                    recipeIds: ['retired-recipe', ...target.recipeIds.slice(1)],
                                })),
                            })),
                        },
                    }))
                ),
            });

            await expect(chooseLeavingUntouched(card)).resolves.toMatchObject({
                status: 'refused',
                reason: expect.stringMatching(/"retired-recipe".*no longer published/u),
            });
        });

        it('refuses a target the project no longer holds, naming its track', async () => {
            const { card } = await ask(mixIntentWith(THREE_READINGS));
            const plan = readingsOf(card).find((reading) => reading.name === READING)?.plan;
            const removedId = plan?.batches[0]?.targetIds[0];
            const removedName = removedId === undefined ? undefined : plan?.trackNames[removedId];
            if (removedId === undefined || removedName === undefined) {
                throw new TypeError('Expected the reading to plan a named track');
            }
            await executeAppAction({ type: 'removeTrack', payload: { trackId: removedId } });

            await expect(chooseLeavingUntouched(card)).resolves.toMatchObject({
                status: 'refused',
                reason: expect.stringMatching(new RegExp(`"${removedName}".*no longer in the project`, 'u')),
            });
        });

        it('refuses a plan the live project prepares differently', async () => {
            const { card } = await ask(mixIntentWith(THREE_READINGS));
            pendingActionConfirmationStore.set({
                confirmations: (pendingActionConfirmationStore.value?.confirmations ?? []).map(
                    withRetainedPlan(card.id, READING, (reading) => ({
                        ...reading,
                        plan: { ...reading.plan, planDigest: 'a-digest-the-live-project-does-not-prepare' },
                    }))
                ),
            });

            await expect(chooseLeavingUntouched(card)).resolves.toMatchObject({
                status: 'refused',
                reason: expect.stringMatching(/no longer plans this reading as offered/u),
            });
        });
    });

    describe('whose project moves while the card is being retired', () => {
        async function chooseWhileRetiring(card: Confirmation, moveProject: () => Promise<void>) {
            const original = pendingActionResourceSettlement.settleBestEffort.bind(pendingActionResourceSettlement);
            let release: () => void = () => undefined;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            vi.spyOn(pendingActionResourceSettlement, 'settleBestEffort').mockImplementation(async (input) => {
                await gate;
                return original(input);
            });
            const rendersBefore = audio.renderTrackSubgraphOffline.mock.calls.length;
            const choosing = chooseVibeBriefReading({
                confirmationId: card.id,
                readingId: readingIdOf(card, 'Darker top end'),
            });
            await moveProject();
            release();
            const outcome = await choosing;
            return { outcome, renders: audio.renderTrackSubgraphOffline.mock.calls.length - rendersBefore };
        }

        function expectRunEndedWithoutPlan(card: Confirmation, renders: number) {
            expect(renders).toBe(0);
            expect(proposedCards()).toEqual([]);
            const run = agentRunLifecycle.get(card.runId);
            expect(run?.phase).toBe('failed');
            expect(run?.plan?.batchSchedule).toBeUndefined();
        }

        it('refuses a reading whose target track was removed during the retire, and measures nothing', async () => {
            const { card } = await ask(mixIntentWith(THREE_READINGS));
            const plan = readingsOf(card).find((reading) => reading.name === 'Darker top end')?.plan;
            const removedId = plan?.batches[0]?.targetIds[0];
            const removedName = removedId === undefined ? undefined : plan?.trackNames[removedId];
            if (removedId === undefined || removedName === undefined) {
                throw new TypeError('Expected the reading to plan a named track');
            }

            const { outcome, renders } = await chooseWhileRetiring(card, () =>
                executeAppAction({ type: 'removeTrack', payload: { trackId: removedId } }).then(() => undefined)
            );

            expect(outcome).toMatchObject({
                status: 'refused',
                reason: expect.stringMatching(new RegExp(`"${removedName}".*no longer in the project`, 'u')),
            });
            expectRunEndedWithoutPlan(card, renders);
        });

        it('refuses a reading whose plan is unchanged but whose brief moved during the retire, and measures nothing', async () => {
            const { card } = await ask(mixIntentWith(THREE_READINGS));

            const { outcome, renders } = await chooseWhileRetiring(card, editBrief);

            expect(outcome).toMatchObject({
                status: 'refused',
                reason: expect.stringMatching(/production brief changed/u),
            });
            expectRunEndedWithoutPlan(card, renders);
        });
    });

    it('refuses a card that offered no readings', async () => {
        const { card } = await ask({
            catalogId: getBriefMixIntentCatalog().catalogId,
            requestedDescriptors: ['warm'],
        });

        await expect(
            chooseVibeBriefReading({ confirmationId: card.id, readingId: 'reading-1' })
        ).resolves.toMatchObject({ status: 'refused', reason: expect.stringMatching(/offers no reading/u) });
    });
});

describe('planning a reading against the plan it was offered with', () => {
    async function offerForPlanning() {
        const { card } = await ask(mixIntentWith(THREE_READINGS));
        const offer = requireOffer(card);
        const reading = offer.readings[0];
        if (reading === undefined) {
            throw new TypeError('Expected a reading');
        }
        const mixIntent = readBriefMixIntent({ catalogId: offer.catalogId, requestedDescriptors: reading.descriptors });
        const run = agentRunLifecycle.get(card.runId);
        if (mixIntent === null || run === null) {
            throw new TypeError('Expected a live run and a catalogue selection');
        }
        return { card, offer, reading, mixIntent, run };
    }

    async function planAgainst(
        offered: Awaited<ReturnType<typeof offerForPlanning>>,
        expectedPlanDigest: string | undefined,
        prompt: string = offered.run.request
    ) {
        const { card, offer, mixIntent, run } = offered;
        const admit = vi.fn(agentWorkBudget.admitMeasurement(card.runId));
        const rendersBefore = audio.renderTrackSubgraphOffline.mock.calls.length;
        const planned = await planVibeRunSchedule({
            prompt,
            context: getProjectContext(),
            brief: offer.brief,
            mixIntent,
            budgets: run.budgets,
            runId: card.runId,
            sourceRevision: settlePendingProjectWritesAndCaptureRevision(),
            signal: new AbortController().signal,
            admit,
            priorReceipts: run.plan?.applicationToolReceipts ?? [],
            expectedPlanDigest,
        });
        return { planned, admit, renders: audio.renderTrackSubgraphOffline.mock.calls.length - rendersBefore };
    }

    it('measures nothing and plans nothing when the live preparation differs from the digest', async () => {
        const offered = await offerForPlanning();

        const { planned, admit, renders } = await planAgainst(offered, 'a-digest-the-live-project-does-not-prepare');

        expect(planned).toMatchObject({
            status: 'unscheduled',
            lines: [expect.stringMatching(/no longer plans this reading as offered/u)],
        });
        expect(admit).not.toHaveBeenCalled();
        expect(renders).toBe(0);
    });

    it('plans nothing, as unscheduled, when a digest is expected and the project now prepares no batch', async () => {
        const offered = await offerForPlanning();
        const protectEverything = 'make this mix warmer but leave the Drums, the Vocal and the Bass alone';
        const withoutDigest = await planAgainst(offered, undefined, protectEverything);
        expect(withoutDigest.planned).toEqual({ status: 'none' });

        const { planned, admit, renders } = await planAgainst(
            offered,
            offered.reading.plan.planDigest,
            protectEverything
        );

        expect(planned).toMatchObject({
            status: 'unscheduled',
            lines: ['No batches were scheduled after the brief: the project no longer plans this reading as offered.'],
        });
        expect(admit).not.toHaveBeenCalled();
        expect(renders).toBe(0);
    });

    it('measures and schedules when the live preparation equals the digest', async () => {
        const offered = await offerForPlanning();

        const { planned, admit, renders } = await planAgainst(offered, offered.reading.plan.planDigest);

        expect(planned.status).toBe('scheduled');
        expect(admit).toHaveBeenCalled();
        expect(renders).toBeGreaterThan(0);
    });
});

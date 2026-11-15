import { type Page } from '@playwright/test';

import { admitLoopbackProvider } from './admitLoopbackProvider';
import { expect, test } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';
import { startScriptedToolProvider, type ScriptedToolCall, type ScriptedToolRequest } from './scriptedToolProvider';

const PROMPT = 'make this mix warmer and more open';
const TRACKS = ['Drums', 'Vocal', 'Bass'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new TypeError('Expected a published schema object.');
    }
    return value;
}
function constText(value: unknown): string {
    const constant = record(value).const;
    if (typeof constant !== 'string') {
        throw new TypeError('Expected a published catalog id.');
    }
    return constant;
}
function onlyEnum(value: unknown): string {
    const options = record(value).enum;
    if (!Array.isArray(options) || options.length !== 1 || typeof options[0] !== 'string') {
        throw new TypeError('Expected exactly one published catalog id.');
    }
    return options[0];
}
function tool(request: ScriptedToolRequest, wireName: string) {
    return request.tools.find((candidate) => candidate.function.name === wireName);
}

function intakeCall(request: ScriptedToolRequest): ScriptedToolCall {
    const intake = tool(request, 'selectCreativeInterpretation');
    if (intake === undefined) {
        throw new Error('Missing the joint intake tool.');
    }
    return {
        id: 'brief-intake',
        name: intake.function.name,
        arguments: {
            catalogId: constText(intake.function.parameters.properties.catalogId),
            modeId: 'brief',
            uncertainty: 'none',
            targetCandidateIds: [],
            editDimensionCandidateIds: [],
            constraintCandidateIds: [],
            creationSlotIds: [],
            answer: null,
            metricIntent: { kind: 'non-acoustic', uncertainty: 'none', objectives: [] },
        },
    };
}

function compileCall(request: ScriptedToolRequest): ScriptedToolCall {
    const compile = tool(request, 'brief_compile');
    if (compile === undefined) {
        throw new Error('Missing the brief compile tool.');
    }
    const mixIntent = record(compile.function.parameters.properties.mixIntent);
    return {
        id: 'brief-compile',
        name: compile.function.name,
        arguments: {
            vision: 'A warmer, more open mix',
            mixIntent: {
                catalogId: onlyEnum(record(mixIntent.properties).catalogId),
                requestedDescriptors: ['warm'],
            },
        },
    };
}

const proposeCall: ScriptedToolCall = {
    id: 'brief-proposal',
    name: 'command_batch_propose',
    arguments: {
        commands: [],
        compiledCallIds: ['brief-compile'],
        plan: {
            semantic: { classification: 'simple', uncertainty: [] },
            objective: 'Record the project intent the request describes.',
            constraints: [],
            scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            capabilityIds: [],
            assetIds: [],
            alternatives: [],
            validationStrategy: ['Compare the brief revision before writing.'],
            stoppingConditions: ['Stop if the brief changes before Confirm.'],
        },
    },
};

/** Answers each request by what it offers; anything unrecognised throws, so the wire records a failure. */
function createVibeRunRoute() {
    const brief = { intake: 0, compile: 0, propose: 0 };
    const valueRequests: number[] = [];
    const respond = (request: ScriptedToolRequest, turn: number): readonly ScriptedToolCall[] => {
        const keepDefaults = request.tools.find((candidate) =>
            /^recipeValues[._]keepDefaults$/.test(candidate.function.name)
        );
        if (keepDefaults !== undefined) {
            valueRequests.push(turn);
            return [
                {
                    id: `values-${String(turn)}`,
                    name: keepDefaults.function.name,
                    arguments: { reason: 'The catalogue defaults suit the measured figures.' },
                },
            ];
        }
        const intake = tool(request, 'selectCreativeInterpretation');
        if (intake !== undefined && 'catalogId' in intake.function.parameters.properties && brief.intake === 0) {
            brief.intake += 1;
            return [intakeCall(request)];
        }
        if (brief.intake === 1 && brief.compile === 0 && tool(request, 'brief_compile') !== undefined) {
            brief.compile += 1;
            return [compileCall(request)];
        }
        if (brief.compile === 1 && brief.propose === 0 && tool(request, 'command_batch_propose') !== undefined) {
            brief.propose += 1;
            return [proposeCall];
        }
        throw new Error(`Unscripted provider request offering ${request.tools.map((t) => t.function.name).join(', ')}`);
    };
    return { respond, brief, valueRequests };
}

async function projectTruth(page: Page) {
    return page.evaluate(async () => {
        const crdt: typeof import('../../src/modules/CrdtDocument/useCases') =
            await import('/src/modules/CrdtDocument/useCases/index.ts');
        const command: typeof import('../../src/modules/Command/stores') =
            await import('/src/modules/Command/stores/index.ts');
        crdt.settlePendingProjectWritesAndCaptureRevision();
        return {
            document: JSON.stringify(crdt.getCrdtDoc('root')),
            undo: JSON.stringify(command.undoHistoryStore.value),
        };
    });
}

async function briefRevision(page: Page): Promise<number> {
    return page.evaluate(async () => {
        const project: typeof import('../../src/modules/Project/stores') =
            await import('/src/modules/Project/stores/index.ts');
        return project.projectStore.value?.productionBrief.revision ?? -1;
    });
}

async function deviceTypes(page: Page, trackName: string): Promise<string[]> {
    return page.evaluate(async (name) => {
        const arrangement: typeof import('../../src/modules/Arrangement/stores') =
            await import('/src/modules/Arrangement/stores/index.ts');
        const track = arrangement.trackStore.value?.tracks.find((candidate) => candidate.name === name);
        if (track === undefined) {
            throw new Error(`Missing track ${name}`);
        }
        return track.devices.map((device) => device.type);
    }, trackName);
}

/** The action history panel opens over the chat card's buttons whenever an AI action lands. */
async function closeActionHistoryOverlay(page: Page) {
    const close = page.getByRole('button', { name: 'Close action history' });
    if ((await close.count()) > 0) {
        await close.click();
    }
    await expect(close).toBeHidden();
}

async function auditionProposal(page: Page, batch: number) {
    const card = page.getByRole('region', { name: 'Measured audio comparison' });
    await expect(card).toBeVisible({ timeout: 60_000 });
    const status = card.getByRole('status');
    await expect(status).toHaveText('Stopped');
    await closeActionHistoryOverlay(page);
    await card.getByRole('button', { name: 'Proposal', exact: true }).click();
    await expect(status, `batch ${String(batch)} proposal audition`).toHaveText('Playing proposal', {
        timeout: 30_000,
    });
    await card.getByRole('button', { name: 'Stop comparison' }).click();
    await expect(status).toHaveText('Stopped');
}

test('drives a whole-project vibe run through brief, per-batch audition, skip and one-step undo', async ({ page }) => {
    test.setTimeout(420_000);
    await setupWorkspace(page);
    await launch_new_project(page);
    await page.evaluate(async (names) => {
        const command: typeof import('../../src/modules/Command/useCases') =
            await import('/src/modules/Command/useCases/index.ts');
        const audio: typeof import('../../src/modules/AudioEngine/useCases') =
            await import('/src/modules/AudioEngine/useCases/index.ts');
        const crdt: typeof import('../../src/modules/CrdtDocument/useCases') =
            await import('/src/modules/CrdtDocument/useCases/index.ts');
        const rate = 48_000;
        for (const name of names) {
            const id = crypto.randomUUID();
            const payload: Parameters<typeof import('../../src/modules/Arrangement/useCases').addTrack>[0] & {
                kind: 'audio';
            } = { id, name, kind: 'audio', gain: 0.8 };
            await command.executeAppAction({ type: 'addTrack', payload });
            const buffer = new AudioBuffer({ numberOfChannels: 2, sampleRate: rate, length: rate * 4 });
            for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                const samples = buffer.getChannelData(channel);
                for (let frame = 0; frame < samples.length; frame++) {
                    const time = frame / rate;
                    samples[frame] =
                        0.4 * Math.sin(2 * Math.PI * 100 * time) + 0.2 * Math.sin(2 * Math.PI * 3000 * time);
                }
            }
            await command.executeAppAction({
                type: 'addClip',
                payload: {
                    trackId: id,
                    name: `${name} take`,
                    type: 'audio',
                    startBeat: 0,
                    endBeat: 8,
                    audioBufferId: audio.cacheAudioBuffer({ buffer }),
                },
            });
        }
        for (const [name, startBeat, endBeat] of [
            ['Verse', 0, 4],
            ['Chorus', 4, 8],
        ] as const) {
            await command.executeAppAction({
                type: 'addSection',
                payload: { sectionId: crypto.randomUUID(), name, startBeat, endBeat },
            });
        }
        crdt.settlePendingProjectWritesAndCaptureRevision();
    }, TRACKS);

    const route = createVibeRunRoute();
    const provider = await startScriptedToolProvider(route.respond);
    try {
        await admitLoopbackProvider(page, provider);
        const before = await projectTruth(page);
        const revisionBefore = await briefRevision(page);
        await page.getByTestId('toggle-chat').click();
        await page.getByRole('combobox', { name: 'Agent execution mode' }).selectOption('apply');
        await page.getByTestId('chat-composer-input').fill(PROMPT);
        await page.getByTestId('chat-composer-input').press('Enter');

        // 1. The brief card lists the four planned batches and applies nothing before Confirm.
        await expect(
            page.getByText('After the brief, 4 batches follow, each measured, previewed and approved on its own:')
        ).toBeVisible({
            timeout: 120_000,
        });
        for (const line of [
            'Batch 2 of 5: warm drums — Drums',
            'Batch 3 of 5: warm vocal — Vocal',
            'Batch 4 of 5: warm bass — Bass',
            'Batch 5 of 5: warm master — Master',
        ]) {
            await expect(page.getByText(line)).toBeVisible();
        }
        expect(await projectTruth(page)).toEqual(before);
        expect(await briefRevision(page)).toBe(revisionBefore);
        await page.getByRole('button', { name: 'Confirm pending actions' }).click();
        await expect.poll(() => briefRevision(page)).toBeGreaterThan(revisionBefore);

        // 2. Batch 2 (Drums): audition, then Confirm.
        await expect(page.getByText(/^Batch 2 of 5: /)).toBeVisible({ timeout: 120_000 });
        await auditionProposal(page, 2);
        expect(await deviceTypes(page, 'Drums')).toEqual([]);
        await page.getByRole('button', { name: 'Confirm pending actions' }).click();
        await expect.poll(() => deviceTypes(page, 'Drums')).toEqual(['builtin-eq']);

        // 3. Batch 3 (Vocal): audition, then Skip; the run goes on and nothing was written.
        await expect(page.getByText(/^Batch 3 of 5: /)).toBeVisible({ timeout: 120_000 });
        await auditionProposal(page, 3);
        const beforeSkip = await projectTruth(page);
        await page.getByRole('button', { name: 'Skip batch' }).click();
        await expect(page.getByText(/^Batch 4 of 5: /)).toBeVisible({ timeout: 120_000 });
        expect(await deviceTypes(page, 'Vocal')).toEqual([]);
        expect(await projectTruth(page)).toEqual(beforeSkip);

        // 4. Batch 4 (Bass): audition, then Confirm.
        await auditionProposal(page, 4);
        await page.getByRole('button', { name: 'Confirm pending actions' }).click();
        await expect.poll(() => deviceTypes(page, 'Bass')).toEqual(['builtin-eq']);

        // The project's master gets a fifth batch; it is auditioned and skipped, so only Drums and Bass change.
        await expect(page.getByText(/^Batch 5 of 5: /)).toBeVisible({ timeout: 120_000 });
        await auditionProposal(page, 5);
        await page.getByRole('button', { name: 'Skip batch' }).click();

        // 5. One summary with the applied and skipped wording.
        await expect(page.getByText('The vibe run finished: the brief and 2 of 4 batches were applied.')).toBeVisible({
            timeout: 120_000,
        });
        await expect(page.getByText(/^Batch 3 \(warm vocal\): skipped, not applied\.$/)).toBeVisible();
        await expect(page.getByText(/^Batch 5 \(warm master\): skipped, not applied\.$/)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Revert run' })).toBeVisible();

        // 6. Each applied batch is one undo step.
        await page.getByTestId('transport-undo').click();
        await expect.poll(() => deviceTypes(page, 'Bass')).toEqual([]);
        expect(await deviceTypes(page, 'Drums')).toEqual(['builtin-eq']);
        await page.getByTestId('transport-undo').click();
        await expect.poll(() => deviceTypes(page, 'Drums')).toEqual([]);

        expect(provider.failures).toEqual([]);
        expect(route.brief).toEqual({ intake: 1, compile: 1, propose: 1 });
        // The skipped batch is grounded, and so asks for its values, before its card is shown.
        expect(route.valueRequests).toHaveLength(4);
        expect(provider.requests).toHaveLength(7);
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
                })),
                runs: stores.agentRunStore.value?.runs.map((run) => ({
                    runId: run.runId,
                    phase: run.phase,
                    errors: run.errors,
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

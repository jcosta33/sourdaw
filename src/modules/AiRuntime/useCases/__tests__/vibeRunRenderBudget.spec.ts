import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { adjustmentLayerStore, type AdjustmentLayer } from '#/modules/Arrangement/stores';
import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { getAgentMeasurementArtifacts, retainAgentMeasurementRenders } from '#/modules/AudioRendering/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { getProjectHandlers } from '#/modules/Project/useCases';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { agentResourceLimitsStore, readAgentResourceLimits } from '../../stores/agentResourceLimitsStore';
import { chatStore } from '../../stores/chatStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunCancellation } from '../cancelAgentRun';
import { agentWorkBudget } from '../agentWorkBudget';
import { configureAgentResourceLimits } from '../configureAgentResourceLimits';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { measureProjectUnit } from '../measureProjectUnit';
import {
    countMeasurementUnitWork,
    planMetricMeasurementRequests,
    planMetricMeasurementUnits,
} from '../planMetricMeasurementRequests';
import { sendChatMessage } from '../sendChatMessage';

import { configureMetricGoalProject, metricGoalAudioBuffer, resetMetricGoalProject } from './metricGoalWorkflowFixture';
import {
    ORDINARY_SONG_BEATS,
    ORDINARY_SONG_SECTIONS,
    ORDINARY_SONG_TRACKS,
    prepareVibeRunEngine,
    releaseVibeRunEngine,
    renderVibeTimeline,
    requireOnlyProposedVibeCard,
    scriptVibeBriefRoute,
    seedVibeBrief,
    sendVibeMessage,
    SECONDS_PER_BEAT,
    vibeCardContent,
    vibeSections,
    vibeTrack,
    type VibeRenderInput,
    type VibeConfirmation,
    type VibeTrackSpec,
} from './vibeRunProjectFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

/**
 * #4372 requirements 1, 3 and 5: a vibe run renders each target once per document it reads, so its
 * render count does not grow with the section count; the whole-run fit counts what execution
 * renders; every section's figure is read from that section's own samples; a measurement unit that
 * stops, times out or is refused leaves the artifact store as it found it and spends only what ran;
 * and a run too large for its budget names the role families that would fit.
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

/** The plan's receipt bound, lowered by one case below to just under what its run persists. */
const receiptBound = vi.hoisted((): { value: number | null } => ({ value: null }));
vi.mock('../../stores/agentRunStore', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../stores/agentRunStore')>();
    return {
        ...original,
        get MAX_PLAN_APPLICATION_TOOL_RECEIPTS() {
            return receiptBound.value ?? original.MAX_PLAN_APPLICATION_TOOL_RECEIPTS;
        },
    };
});

const audio = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn<typeof renderTrackSubgraphOffline>(),
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...audio,
}));

const SONG_BEATS = 64;
const DRUM_KIT: VibeTrackSpec[] = [
    { id: 'track-kick', name: 'Kick', role: 'kick' },
    { id: 'track-snare', name: 'Snare', role: 'snare' },
    { id: 'track-hats', name: 'Hats', role: 'hi-hat' },
];
const EIGHT_SECTIONS = vibeSections(
    ['Intro', 'Verse 1', 'Pre Chorus', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Bridge', 'Outro'],
    SONG_BEATS / 8
);
/** Per-target timeouts for whole-run cases that render real buffers through the real measurement path. */
const WHOLE_RUN_TIMEOUT_MS = 30_000;

function useProject(tracks: readonly VibeTrackSpec[], sections: ReturnType<typeof vibeSections>, beats = SONG_BEATS) {
    configureMetricGoalProject({
        label: 'vibe run render budget test',
        tracks: tracks.map((spec) => vibeTrack(spec, beats)),
        sections,
    });
    registerHandlerMap(getProjectHandlers());
    prepareVibeRunEngine();
    seedVibeBrief(tracks);
}

/** The renders the fit says the run needs, read from its refusal under a budget of none. */
async function readFitRenders(descriptors: readonly string[]): Promise<number> {
    agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, maxRenderJobs: 0 });
    scriptVibeBriefRoute({ descriptors });
    await sendVibeMessage('make this mix warmer', (prompt) => sendChatMessage(prompt));
    const content = vibeCardContent(requireOnlyProposedVibeCard());
    const needed = /need (\d+) renders, more than the 0/u.exec(content);
    if (needed === null) {
        throw new Error(`Expected a render refusal: ${content}`);
    }
    expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    return Number(needed[1]);
}

/** The renders the run executes: its initial figures, then its one batch's preview once the brief is confirmed. */
async function readExecutedRenders(descriptors: readonly string[]): Promise<number> {
    scriptVibeBriefRoute({ descriptors });
    await sendVibeMessage('make this mix warmer', (prompt) => sendChatMessage(prompt));
    const brief = requireOnlyProposedVibeCard();
    expect(vibeCardContent(brief)).not.toContain('No batches were scheduled');
    expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule?.total).toBe(2);
    await expect(confirmPendingChatActions({ confirmationId: brief.id })).resolves.toEqual({ status: 'executed' });
    expect(requireOnlyProposedVibeCard().approvalSnapshot.batchPosition).toEqual({ index: 2, total: 2 });
    const renders = audio.renderTrackSubgraphOffline.mock.calls.length;
    expect(agentRunLifecycle.get(brief.runId)?.budgets.consumed.maxRenderJobs).toBe(renders);
    return renders;
}

function sounding(input: VibeRenderInput): AudioBuffer {
    return renderVibeTimeline(input, () => 1);
}

beforeEach(() => {
    vi.mocked(generateToolPlanningOutcome).mockReset();
    runtimeMocks.backend.value = 'cloud';
    audio.renderTrackSubgraphOffline.mockReset().mockImplementation(async (input) => sounding(input));
    audio.renderOffline.mockReset().mockImplementation(async () => {
        throw new Error('A track-scoped run must not render the master.');
    });
    audio.renderOfflineInput.mockReset().mockImplementation(async () => {
        throw new Error('A run must be measured on its rendered scope, never on source audio.');
    });
});

afterEach(() => {
    receiptBound.value = null;
    releaseVibeRunEngine([...DRUM_KIT, ...ORDINARY_SONG_TRACKS]);
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    resetMetricGoalProject();
    vi.restoreAllMocks();
});

describe('the render count of a vibe run', () => {
    // Three drum targets in one batch of three steps: Kick is read at its own step and the whole
    // batch, Snare at its own, the one before it and the whole batch, Hats at its own and the one
    // before. Each target renders once live and once per prefix document it is read in:
    // 3 initial + (1 + 2) + (1 + 3) + (1 + 2) = 13, whatever the section count.
    const RUN_RENDERS = 13;

    it.each([
        { label: 'no sections', sections: [] },
        { label: 'eight sections', sections: EIGHT_SECTIONS },
    ])(
        'fits and executes the same renders with $label',
        async ({ sections }) => {
            useProject(DRUM_KIT, sections);
            const fit = await readFitRenders(['warm']);
            resetMetricGoalProject();
            audio.renderTrackSubgraphOffline.mockClear();
            agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
            useProject(DRUM_KIT, sections);
            const executed = await readExecutedRenders(['warm']);
            expect({ fit, executed }).toEqual({ fit: RUN_RENDERS, executed: RUN_RENDERS });
        },
        WHOLE_RUN_TIMEOUT_MS
    );
});

describe('a section figure', () => {
    const VERSE = { id: 'verse', name: 'Verse', startBeat: 0, endBeat: 8, color: '#ffffff' };
    const CHORUS = { id: 'chorus', name: 'Chorus', startBeat: 8, endBeat: 16, color: '#ffffff' };
    const KICK = DRUM_KIT[0]!;

    /** Quiet through the verse, loud through the chorus, so a figure read from the wrong samples is off. */
    function sectionedLevel(input: VibeRenderInput): AudioBuffer {
        return renderVibeTimeline(input, (seconds) => (seconds < CHORUS.startBeat * SECONDS_PER_BEAT ? 0.1 : 0.8));
    }

    it('is read from that section’s own samples, exactly as a render of that section alone reads', async () => {
        useProject([KICK], [VERSE, CHORUS], 16);
        audio.renderTrackSubgraphOffline.mockImplementation(async (input) => sectionedLevel(input));
        const context = getProjectContext();
        const ranges = [
            { startBeat: 0, endBeat: 16, sectionId: null },
            { startBeat: VERSE.startBeat, endBeat: VERSE.endBeat, sectionId: VERSE.id },
            { startBeat: CHORUS.startBeat, endBeat: CHORUS.endBeat, sectionId: CHORUS.id },
        ];
        const [unit, ...rest] = planMetricMeasurementUnits({
            requests: planMetricMeasurementRequests({
                context,
                reads: ranges.map((range) => ({ prefix: 'initial', range, metricId: 'rms', targetIds: [KICK.id] })),
            }),
            subject: 'project',
        });
        expect(rest).toEqual([]);
        const measured = await measureProjectUnit(
            { projectRevision: captureProjectRevision(), sections: context.sections ?? [] },
            unit!
        );
        if (measured.status !== 'measured') {
            throw new Error(`Expected the unit to measure: ${measured.failure.safeMessage}`);
        }
        // The whole unit rendered once.
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
        for (const [index, range] of ranges.entries()) {
            const input = audio.renderTrackSubgraphOffline.mock.calls[0]![0];
            const alone = measureAgentScopeRender(
                sectionedLevel({ ...input, startBeat: range.startBeat, endBeat: range.endBeat }),
                ['rms']
            );
            expect(measured.reads[index]?.measurement.range).toMatchObject(range);
            expect(measured.reads[index]?.measurement.targets[0]?.measurements.rms).toEqual(alone.rms);
        }
        const rms = (index: number) => {
            const entry = measured.reads[index]?.measurement.targets[0]?.measurements.rms;
            expect(entry).toMatchObject({ status: 'measured', unit: 'dBFS' });
            return entry?.status === 'measured' && typeof entry.value === 'number' ? entry.value : Number.NaN;
        };
        // The chorus plays eight times louder than the verse.
        expect(rms(2) - rms(1)).toBeCloseTo(20 * Math.log10(8), 1);
    });
});

describe('a section figure under an adjustment layer', () => {
    const VERSE = { id: 'verse', name: 'Verse', startBeat: 0, endBeat: 8, color: '#ffffff' };
    const CHORUS = { id: 'chorus', name: 'Chorus', startBeat: 8, endBeat: 16, color: '#ffffff' };
    const KICK = DRUM_KIT[0]!;
    /** An EQ layer over the verse alone: steady across a render ending at the verse, moving across one past it. */
    const VERSE_EQ: AdjustmentLayer = {
        id: 'verse-eq',
        name: 'Verse EQ',
        effectType: 'eq',
        parameters: [{ name: 'Low Gain', value: -6, min: -24, max: 24, unit: 'dB' }],
        affectedTrackIds: [KICK.id],
        insertionIndex: 0,
        regions: [{ id: 'verse', startBeat: 0, endBeat: VERSE.endBeat, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
        enabled: true,
        mix: 1,
        color: '#fff',
    };
    const EQ_LEVEL = 0.5;

    /**
     * The offline render's law for a DSP layer, stated independently of the planner: the render
     * classifies the layer over its whole span from beat 0 and applies it only when every region
     * reaching that span covers it whole without fades; a moving layer is skipped.
     */
    function layerRender(input: VibeRenderInput): AudioBuffer {
        const steady = VERSE_EQ.regions.every(
            (region) =>
                region.endBeat <= 0 ||
                region.startBeat >= input.endBeat ||
                (region.startBeat <= 0 &&
                    region.endBeat >= input.endBeat &&
                    region.fadeInBeats === 0 &&
                    region.fadeOutBeats === 0)
        );
        const eq = steady ? EQ_LEVEL : 1;
        return renderVibeTimeline(input, (seconds) => (seconds < VERSE.endBeat * SECONDS_PER_BEAT ? eq : 1));
    }

    afterEach(() => {
        adjustmentLayerStore.set({ layers: [] });
        flushAutomergeStorageWrites();
    });

    it('renders apart the ranges a moving-layer threshold separates, each figure the one its range alone reads', async () => {
        useProject([KICK], [VERSE, CHORUS], 16);
        adjustmentLayerStore.set({ layers: [VERSE_EQ] });
        // The layer reaches the document before the measurement reads its revision.
        flushAutomergeStorageWrites();
        audio.renderTrackSubgraphOffline.mockImplementation(async (input) => layerRender(input));
        const context = getProjectContext();
        const ranges = [
            { startBeat: VERSE.startBeat, endBeat: VERSE.endBeat, sectionId: VERSE.id },
            { startBeat: CHORUS.startBeat, endBeat: CHORUS.endBeat, sectionId: CHORUS.id },
        ];
        const [unit, ...rest] = planMetricMeasurementUnits({
            requests: planMetricMeasurementRequests({
                context,
                reads: ranges.map((range) => ({ prefix: 'initial', range, metricId: 'rms', targetIds: [KICK.id] })),
            }),
            subject: 'project',
        });
        expect(rest).toEqual([]);
        // One render ending at the verse, where the layer is steady, and one for the chorus past it.
        expect(unit?.groups.map(({ startBeat, endBeat }) => ({ startBeat, endBeat }))).toEqual([
            { startBeat: 0, endBeat: 8 },
            { startBeat: 8, endBeat: 16 },
        ]);
        expect(countMeasurementUnitWork(unit!).renderJobs).toBe(2);
        const measured = await measureProjectUnit(
            { projectRevision: captureProjectRevision(), sections: context.sections ?? [] },
            unit!
        );
        if (measured.status !== 'measured') {
            throw new Error(`Expected the unit to measure: ${measured.failure.safeMessage}`);
        }
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(2);
        const input = audio.renderTrackSubgraphOffline.mock.calls[0]![0];
        for (const [index, range] of ranges.entries()) {
            const alone = measureAgentScopeRender(
                layerRender({ ...input, startBeat: range.startBeat, endBeat: range.endBeat }),
                ['rms']
            );
            expect(measured.reads[index]?.measurement.range).toMatchObject(range);
            expect(measured.reads[index]?.measurement.targets[0]?.measurements.rms).toEqual(alone.rms);
        }
        // The verse alone carries the layer's cut; a render reaching into the chorus would have dropped it.
        const verse = measured.reads[0]?.measurement.targets[0]?.measurements.rms;
        const uncut = measureAgentScopeRender(
            layerRender({ ...input, startBeat: VERSE.startBeat, endBeat: CHORUS.endBeat }),
            ['rms']
        );
        expect(verse).not.toEqual(uncut.rms);
    });

    describe('a batch preview unit that does not finish', () => {
        type Spend = { renders: number; analyses: number };

        /** A one-target run over the verse and the chorus, whose layer splits the preview unit into two range groups. */
        async function proposeBrief(): Promise<VibeConfirmation> {
            useProject([KICK], [VERSE, CHORUS], 16);
            adjustmentLayerStore.set({ layers: [VERSE_EQ] });
            flushAutomergeStorageWrites();
            scriptVibeBriefRoute({ descriptors: ['warm'] });
            await sendVibeMessage('make this mix warmer', (prompt) => sendChatMessage(prompt));
            return requireOnlyProposedVibeCard();
        }

        function readSpend(runId: string): Spend {
            const consumed = agentRunLifecycle.get(runId)?.budgets.consumed;
            return { renders: consumed?.maxRenderJobs ?? 0, analyses: consumed?.localAnalysis ?? 0 };
        }

        function readRetained() {
            return getAgentMeasurementArtifacts().map(({ contentAddress, sourceRevision }) => ({
                contentAddress,
                sourceRevision,
            }));
        }

        function preparingLine(): string | undefined {
            return chatStore.value?.messages.find((message) => message.content.startsWith('Preparing batch'))?.content;
        }

        /** Confirms the brief, so its one batch previews, and reports what the preview spent and left behind. */
        async function confirmAndRead(brief: VibeConfirmation, renders: () => number) {
            const before = { retained: readRetained(), spent: readSpend(brief.runId) };
            await confirmPendingChatActions({ confirmationId: brief.id });
            const after = readSpend(brief.runId);
            return {
                retainedUnchanged: readRetained(),
                before: before.retained,
                spent: {
                    renders: after.renders - before.spent.renders,
                    analyses: after.analyses - before.spent.analyses,
                },
                rendered: renders(),
            };
        }

        it('stops on the run’s cancel mid-render, retaining nothing and spending the one render that ran', async () => {
            const brief = await proposeBrief();
            let rendered = 0;
            audio.renderTrackSubgraphOffline.mockImplementation(async (input) => {
                rendered += 1;
                // What the panel's Stop does, while the first preview render runs.
                void agentRunCancellation.cancel({ runId: brief.runId, reason: 'Cancelled by user' });
                return sounding(input);
            });
            const read = await confirmAndRead(brief, () => rendered);
            expect(read.retainedUnchanged).toEqual(read.before);
            expect(read).toMatchObject({ rendered: 1, spent: { renders: 1, analyses: 0 } });
        });

        it('times out past its wall-clock allowance, retaining nothing and spending the render that ran', async () => {
            const brief = await proposeBrief();
            configureAgentResourceLimits({ measurementWallClockMs: 50 });
            let rendered = 0;
            audio.renderTrackSubgraphOffline.mockImplementation(async (input) => {
                rendered += 1;
                await new Promise((resolve) => setTimeout(resolve, 100));
                return sounding(input);
            });
            const read = await confirmAndRead(brief, () => rendered);
            expect(read.retainedUnchanged).toEqual(read.before);
            expect(read).toMatchObject({ rendered: 1, spent: { renders: 1, analyses: 0 } });
        });

        it('is refused in its second range group after the first rendered and reduced, retaining none of the first', async () => {
            const brief = await proposeBrief();
            let rendered = 0;
            const lines: (string | undefined)[] = [];
            audio.renderTrackSubgraphOffline.mockImplementation(async (input) => {
                rendered += 1;
                lines.push(preparingLine());
                // The first group renders the project and the batch over the verse; the second
                // group's project render fails.
                if (rendered === 3) {
                    throw new Error('second group render failed');
                }
                return sounding(input);
            });
            const read = await confirmAndRead(brief, () => rendered);
            expect(lines).toEqual([
                'Preparing batch 2 of 2: rendering Kick as it is now, ranges 1 of 2...',
                'Preparing batch 2 of 2: rendering Kick with the whole batch applied, ranges 1 of 2...',
                'Preparing batch 2 of 2: rendering Kick as it is now, ranges 2 of 2...',
            ]);
            expect(read.retainedUnchanged).toEqual(read.before);
            // Three renders started; the verse read of the first group was reduced.
            expect(read).toMatchObject({ rendered: 3, spent: { renders: 3, analyses: 1 } });
        });
    });
});

describe('a measurement unit that does not finish', () => {
    const RUN_ID = 'render-budget-run';
    const TARGETS = DRUM_KIT.slice(0, 2);

    function startRun() {
        agentRunLifecycle.create({ runId: RUN_ID, request: 'measure', mode: 'plan', createdRevision: null });
        agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });
    }

    function twoTargetUnit() {
        const context = getProjectContext();
        const [unit] = planMetricMeasurementUnits({
            requests: planMetricMeasurementRequests({
                context,
                reads: [
                    {
                        prefix: 'initial',
                        range: { startBeat: 0, endBeat: 16, sectionId: null },
                        metricId: 'rms',
                        targetIds: TARGETS.map((track) => track.id),
                    },
                ],
            }),
            subject: 'project',
        });
        return unit!;
    }

    function readRetained() {
        return getAgentMeasurementArtifacts().map(({ contentAddress, sourceRevision }) => ({
            contentAddress,
            sourceRevision,
        }));
    }

    /** One render already retained, so "unchanged" is a store that still holds it and nothing else. */
    function seedRetainedRender() {
        retainAgentMeasurementRenders({
            renders: [{ contentAddress: 'seeded-render', buffer: metricGoalAudioBuffer(() => 0.5, 1) }],
            sourceRevision: captureProjectRevision(),
        });
        expect(readRetained()).toHaveLength(1);
        return readRetained();
    }

    beforeEach(() => {
        useProject(TARGETS, [], 16);
        startRun();
    });

    it('stops on the run’s cancel after the first render, retaining nothing and spending one render', async () => {
        const before = seedRetainedRender();
        const controller = new AbortController();
        audio.renderTrackSubgraphOffline.mockImplementation(async (input) => {
            controller.abort();
            return sounding(input);
        });
        const measured = await measureProjectUnit(
            {
                projectRevision: captureProjectRevision(),
                sections: [],
                signal: controller.signal,
                admit: agentWorkBudget.admitMeasurement(RUN_ID),
            },
            twoTargetUnit()
        );
        expect(measured).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
        expect(readRetained()).toEqual(before);
        expect(agentRunLifecycle.get(RUN_ID)?.budgets.consumed).toMatchObject({ maxRenderJobs: 1, localAnalysis: 0 });
    });

    it('times out past its wall-clock allowance, retaining nothing and spending what rendered', async () => {
        const before = seedRetainedRender();
        configureAgentResourceLimits({ measurementWallClockMs: 50 });
        audio.renderTrackSubgraphOffline.mockImplementation(async (input) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return sounding(input);
        });
        const measured = await measureProjectUnit(
            {
                projectRevision: captureProjectRevision(),
                sections: [],
                admit: agentWorkBudget.admitMeasurement(RUN_ID),
            },
            twoTargetUnit()
        );
        expect(measured).toMatchObject({ status: 'failed', failure: { code: 'measurement-timed-out' } });
        expect(audio.renderTrackSubgraphOffline).toHaveBeenCalledTimes(1);
        expect(readRetained()).toEqual(before);
        expect(agentRunLifecycle.get(RUN_ID)?.budgets.consumed).toMatchObject({ maxRenderJobs: 1, localAnalysis: 0 });
    });

    it('is refused before rendering when the run cannot hold its planned renders, spending nothing', async () => {
        const before = seedRetainedRender();
        agentResourceLimitsStore.set({ ...readAgentResourceLimits(), maxRenderJobs: 1 });
        agentRunLifecycle.clear();
        startRun();
        const measured = await measureProjectUnit(
            {
                projectRevision: captureProjectRevision(),
                sections: [],
                admit: agentWorkBudget.admitMeasurement(RUN_ID),
            },
            twoTargetUnit()
        );
        expect(measured).toMatchObject({ status: 'failed', failure: { code: 'measurement-budget-exhausted' } });
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect(readRetained()).toEqual(before);
        expect(agentRunLifecycle.get(RUN_ID)?.budgets.consumed.maxRenderJobs ?? 0).toBe(0);
    });
});

describe('a run whose receipts would pass the plan’s receipt bound', () => {
    it('is refused before scheduling with what it needs and what is left, and renders nothing', async () => {
        useProject(DRUM_KIT, [], 16);
        await readExecutedRenders(['warm']);
        const brief = requireOnlyProposedVibeCard();
        const receipts = agentRunLifecycle.get(brief.runId)?.plan?.applicationToolReceipts ?? [];
        const verification = receipts.filter((receipt) => receipt.origin === 'application-verification').length;
        const prior = receipts.length - verification;
        expect(verification).toBeGreaterThan(0);
        resetMetricGoalProject();
        audio.renderTrackSubgraphOffline.mockClear();

        // One receipt short of what the run persists.
        receiptBound.value = receipts.length - 1;
        useProject(DRUM_KIT, [], 16);
        scriptVibeBriefRoute({ descriptors: ['warm'] });
        await sendVibeMessage('make this mix warmer', (prompt) => sendChatMessage(prompt));

        const refused = requireOnlyProposedVibeCard();
        expect(vibeCardContent(refused)).toContain(
            `No batches were scheduled after the brief: initial measurements and every preview need ${String(verification)} receipts, more than the ${String(receipts.length - 1 - prior)} this run's plan has room for under its bound of ${String(receipts.length - 1)}; no role family fits on its own.`
        );
        expect(agentRunLifecycle.get(refused.runId)?.plan?.batchSchedule).toBeUndefined();
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });
});

describe('a run larger than its render budget', () => {
    it('names the largest set of role families that would fit, and schedules nothing', async () => {
        useProject(ORDINARY_SONG_TRACKS, ORDINARY_SONG_SECTIONS, ORDINARY_SONG_BEATS);
        agentResourceLimitsStore.set({ ...DEFAULT_AGENT_RESOURCE_LIMITS, maxRenderJobs: 64 });
        scriptVibeBriefRoute({ descriptors: ['warm', 'wide'] });

        await sendVibeMessage('make this mix warmer and wider', (prompt) => sendChatMessage(prompt));

        const brief = requireOnlyProposedVibeCard();
        expect(vibeCardContent(brief)).toContain(
            "No batches were scheduled after the brief: initial measurements and previewing every batch need 122 renders, more than the 64 this run's maxRenderJobs budget has left; the drums and vocal families (12 tracks) fit."
        );
        expect(agentRunLifecycle.get(brief.runId)?.plan?.batchSchedule).toBeUndefined();
        expect(audio.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });
});

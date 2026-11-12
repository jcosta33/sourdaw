import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';
import { type renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { getAgentMeasurementArtifacts, retainAgentMeasurementRenders } from '#/modules/AudioRendering/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { getProjectHandlers } from '#/modules/Project/useCases';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { agentResourceLimitsStore, readAgentResourceLimits } from '../../stores/agentResourceLimitsStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';
import { configureAgentResourceLimits } from '../configureAgentResourceLimits';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { measureProjectUnit } from '../measureProjectUnit';
import { planMetricMeasurementRequests, planMetricMeasurementUnits } from '../planMetricMeasurementRequests';
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

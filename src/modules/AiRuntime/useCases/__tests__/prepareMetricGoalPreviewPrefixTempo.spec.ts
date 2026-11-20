import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { adjustmentLayerStore, type AdjustmentLayer } from '#/modules/Arrangement/stores';
import { configureOfflinePpqEndpointProjection } from '#/modules/AudioEngine/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import {
    beatAtSecondsFromAnchor,
    projectPpqEndpoints,
    restoreTimelineMapSnapshot,
    restoreTransportSnapshot,
} from '#/modules/Transport/useCases';
import { digest } from '#/utils/canonicalDigest';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { getCreativeSelectionSnapshot } from '../../models/CreativeInterpretation';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { getProjectContext } from '../getProjectContext';
import { type MetricGoal, type MetricGoalState } from '../metricGoalContractTypes';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { prepareMetricGoalPreview } from '../prepareMetricGoalPreview';

import { metricGoalAudioBuffer, resetMetricGoalProject } from './metricGoalWorkflowFixture';
import { compileTempoBatch, configureTempoMapProject, SECTIONS } from './prefixTempoBatchFixture';

registerDeviceEnginePorts();

const audio = vi.hoisted(() => ({
    renderTrackSubgraphOffline: vi.fn(),
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ...audio,
}));

const RUN_ID = 'prepare-metric-goal-preview-prefix-tempo';
const PROMPT = 'Double the tempo and keep the master level';
const RECIPE_ID = 'bass-warm';

/** A DSP layer whose one region starts at beat 16: steady across a mixdown span ending at or before it. */
const LATE_EQ: AdjustmentLayer = {
    id: 'late-eq',
    name: 'Late EQ',
    effectType: 'eq',
    parameters: [{ name: 'Low Gain', value: -6, min: -24, max: 24, unit: 'dB' }],
    affectedTrackIds: [],
    insertionIndex: 0,
    regions: [{ id: 'late', startBeat: 16, endBeat: 24, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
    enabled: true,
    mix: 1,
    color: '#fff',
};

type MixdownOptions = { startBeat: number; durationBeats: number };

function sectionGoal(section: (typeof SECTIONS)[number]): MetricGoal {
    return {
        goalId: `hold:${section.id}`,
        stepId: 'overall',
        metricId: 'rms',
        band: null,
        targetIds: ['master'],
        referenceTargetIds: [],
        range: { startBeat: section.startBeat, endBeat: section.endBeat, sectionId: section.id },
        relation: 'hold',
        targetValue: null,
        tolerance: 1,
        source: {
            kind: 'recipe',
            recipeId: RECIPE_ID,
            catalogVersion: 0,
            recipeDigest: digest(RECIPE_ID),
            expectationIndex: 0,
        },
    };
}

const SECTION_SPANS = [
    { startBeat: 0, durationBeats: 8 },
    { startBeat: 8, durationBeats: 8 },
];

function mixdownBuffer(options: MixdownOptions): AudioBuffer {
    return metricGoalAudioBuffer((time) => 0.4 * Math.sin(2 * Math.PI * 100 * time), options.durationBeats);
}

beforeEach(() => {
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    configureOfflinePpqEndpointProjection({
        project: projectPpqEndpoints,
        resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
        beatAtSecondsFromAnchor,
    });
    audio.renderTrackSubgraphOffline.mockReset().mockRejectedValue(new Error('A master goal renders the mixdown.'));
    audio.renderOffline.mockReset().mockImplementation(async (options: MixdownOptions) => mixdownBuffer(options));
    audio.renderOfflineInput
        .mockReset()
        .mockImplementation(async (_input: unknown, options: MixdownOptions) => mixdownBuffer(options));
    configureTempoMapProject(RUN_ID, SECTIONS);
    adjustmentLayerStore.set({ layers: [LATE_EQ] });
    flushAutomergeStorageWrites();
});

afterEach(() => {
    adjustmentLayerStore.set({ layers: [] });
    restoreTransportSnapshot({ tempo: 120 });
    restoreTimelineMapSnapshot({ tempoMap: { changes: [] } });
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    resetMetricGoalProject();
});

describe('a metric-goal preview whose batch changes the tempo', () => {
    it('renders apart the sections the prefix document’s tempo map carries across a layer threshold', async () => {
        expect(
            agentRunLifecycle.create({
                runId: RUN_ID,
                request: PROMPT,
                mode: 'apply',
                createdRevision: captureProjectRevision(),
            })
        ).toEqual({ status: 'created' });
        agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });
        const { compiled } = compileTempoBatch(RUN_ID, PROMPT);
        const held = metricGoalStateCodec(compiled.metricGoalState);
        if (held === null) {
            throw new Error('The card compiles a metric-goal state.');
        }
        const state: MetricGoalState = {
            ...held,
            authorities: [
                {
                    schemaVersion: 1,
                    authorityId: 'hold-master-level',
                    origin: 'configured-joint-intake',
                    callId: 'hold-intake',
                    turn: 1,
                    catalogId: RUN_ID,
                    requestDigest: digest(PROMPT),
                    revision: held.binding?.revision ?? '',
                    projectId: captureProjectIdentity(),
                    selection: getCreativeSelectionSnapshot(getProjectContext()),
                    kind: 'perceptual',
                    goals: SECTIONS.map(sectionGoal),
                    creativeAuthority: null,
                },
                ...held.authorities,
            ],
        };

        await prepareMetricGoalPreview({
            state,
            commandBatch: compiled.commandBatch,
            context: getProjectContext(),
            prompt: PROMPT,
            runId: RUN_ID,
        });

        // One mixdown group per section: each group renders in the live project and in the prefix document.
        const spans = (calls: unknown[][]) =>
            calls.map((call) => {
                const { startBeat, durationBeats } = call.at(-1) as MixdownOptions;
                return { startBeat, durationBeats };
            });
        expect(spans(audio.renderOffline.mock.calls)).toEqual(SECTION_SPANS);
        expect(spans(audio.renderOfflineInput.mock.calls)).toEqual(SECTION_SPANS);
    });
});

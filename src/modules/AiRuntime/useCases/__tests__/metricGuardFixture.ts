import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { createTrack } from '#/modules/Arrangement/useCases';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { admitMetricIntent } from '../admitMetricIntent';
import { bindMetricGoalsToBatch } from '../bindMetricGoalsToBatch';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getProjectContext } from '../getProjectContext';
import { type MetricGoalState } from '../metricGoalContractTypes';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';
import { prepareMetricIntentCatalog } from '../prepareMetricIntentCatalog';

import { configureMetricGoalProject } from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();

export function metricGuardFixture() {
    const bass = createTrack({ id: 'bass', name: 'Bass', kind: 'audio' });
    bass.clips = [
        {
            id: 'clip',
            trackId: 'bass',
            name: 'Clip',
            type: 'audio',
            startBeat: 0,
            endBeat: 4,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#ffffff',
            locked: false,
            muted: false,
        },
    ];
    configureMetricGoalProject({
        label: 'metric guard contracts',
        tracks: [bass, createTrack({ id: 'drums', name: 'Drums', kind: 'audio' })],
        sections: [],
    });
    const prompt = 'Make Bass brighter than Drums';
    const revision = captureProjectRevision();
    const context = getProjectContext();
    const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: revision });
    const catalog = prepareMetricIntentCatalog({ prompt, answer });
    const scope = catalog.scopes.find((entry) => entry.objectIds.length === 1 && entry.objectIds[0] === 'bass');
    const reference = catalog.scopes.find((entry) => entry.objectIds.length === 1 && entry.objectIds[0] === 'drums');
    const range = catalog.ranges.find((entry) => entry.startBeat === 0 && entry.endBeat === 4);
    if (!scope || !reference || !range) {
        throw new Error('Expected published subjects and arrangement range');
    }
    const admitted = admitMetricIntent({
        catalog,
        creativeAuthority: null,
        workflowTargetIds: ['bass'],
        callId: 'intake',
        turn: 1,
        value: {
            kind: 'comparative',
            uncertainty: 'none',
            objectives: [
                {
                    objectiveId: catalog.objectives.find((entry) =>
                        entry.goals.some((goal) => goal.relation === 'greater-than-current')
                    )!.id,
                    scopeCandidateId: scope.candidateId,
                    referenceScopeCandidateId: reference.candidateId,
                    rangeCandidateId: range.candidateId,
                },
            ],
        },
    });
    if (admitted.status !== 'admitted') {
        throw new Error(admitted.reason);
    }
    const opposed = admitMetricIntent({
        catalog,
        creativeAuthority: null,
        workflowTargetIds: ['bass'],
        callId: 'opposed',
        turn: 1,
        value: {
            kind: 'comparative',
            uncertainty: 'none',
            objectives: [
                {
                    objectiveId: catalog.objectives.find((entry) =>
                        entry.goals.some((goal) => goal.relation === 'less-than-current')
                    )!.id,
                    scopeCandidateId: scope.candidateId,
                    referenceScopeCandidateId: reference.candidateId,
                    rangeCandidateId: range.candidateId,
                },
            ],
        },
    });
    if (opposed.status !== 'admitted') throw new Error(opposed.reason);
    const commandBatch = compilePlannedActionCommandBatch({
        actions: [
            { type: 'setTrackGain', payload: { trackId: 'bass', gain: 0.8, expectedGain: 1 } },
            { type: 'setTrackGain', payload: { trackId: 'drums', gain: 0.8, expectedGain: 1 } },
        ],
        actionLabels: ['Bass', 'Drums'],
        autoCommit: false,
        context,
        group: { groupId: 'guard', groupLabel: prompt },
        intent: prompt,
        projectRevision: revision,
        runId: 'guard',
    }).commandBatch;
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status !== 'valid') throw new Error(parsed.reason);
    const initial: MetricGoalState = {
        schemaVersion: 1,
        authorities: [admitted.authority],
        steps: [
            {
                stepId: 'overall',
                commandCount: parsed.envelope.commands.length,
                operationTypes: parsed.envelope.commands.map((command) => command.operation),
                recipePrefixHash: null,
            },
        ],
        proofs: [],
        binding: null,
    };
    const bound = bindMetricGoalsToBatch({ commandBatch, state: initial });
    if (!bound.binding) throw new Error('Expected binding');
    const metric = (value: number) => ({
        status: 'measured' as const,
        metricVersion: 1,
        unit: 'hertz',
        value,
        confidence: 'exact' as const,
    });
    const targets = ['bass', 'drums'].map((targetId) => ({
        targetId,
        targetKind: 'track' as const,
        baseline: { spectralCentroid: metric(targetId === 'bass' ? 900 : 700) },
        preview: { spectralCentroid: metric(targetId === 'bass' ? 1000 : 700) },
        deltas: {},
    }));
    const artifact = { route: 'isolated-subgraph' as const, artifact: { contentAddress: 'audio' } };
    const state: MetricGoalState = {
        ...bound,
        proofs: [
            {
                receiptDigest: 'receipt',
                preview: {
                    provenance: {
                        origin: 'planner',
                        callId: 'measurement',
                        turn: 2,
                        runId: 'guard',
                        targets: targets.map(({ targetId }) => ({ targetId, baseline: artifact, preview: artifact })),
                    },
                    scope: { kind: 'tracks', ids: ['bass', 'drums'] },
                    range: { startBeat: range.startBeat, endBeat: range.endBeat, sectionId: range.sectionId },
                    targets,
                    batchContentHash: bound.binding.contentHash,
                    revision,
                },
            },
        ],
    };
    function bind(value: MetricGoalState) {
        const rebound = bindMetricGoalsToBatch({ commandBatch, state: value });
        const decoded = metricGoalStateCodec(JSON.stringify(rebound));
        if (!decoded) throw new Error('Codec refused fixture');
        return decoded;
    }
    function evaluate(value: MetricGoalState) {
        return evaluateMetricGoalAdmission({ state: value, commandBatch, currentRevision: revision });
    }
    return { state: bind(state), bind, evaluate, opposed: opposed.authority };
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { createTrack } from '#/modules/Arrangement/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState } from '#/modules/Project/stores';
import { getProjectHandlers } from '#/modules/Project/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { admitPlanningInterpretation } from '../admitPlanningInterpretation';
import { bindMetricGoalsToBatch } from '../bindMetricGoalsToBatch';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { getProjectContext } from '../getProjectContext';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';
import { prepareMetricIntentCatalog } from '../prepareMetricIntentCatalog';

import {
    configuredLiteralMetricState,
    configureMetricGoalProject,
    resetMetricGoalProject,
} from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();
beforeEach(() => {
    const track = createTrack({ id: 'drums', name: 'Drums', kind: 'audio' });
    track.clips = [
        {
            id: 'intro',
            trackId: 'drums',
            name: 'Intro',
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
    configureMetricGoalProject({ label: 'non acoustic clip', tracks: [track], sections: [] });
    registerHandlerMap(getTransportHandlers());
    registerHandlerMap(getProjectHandlers());
});
afterEach(resetMetricGoalProject);

function evaluate(prompt: string, action: AppAction, literal = false) {
    const revision = captureProjectRevision();
    const context = getProjectContext();
    const creative = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: revision });
    const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: revision });
    const metric = prepareMetricIntentCatalog({ prompt, answer });
    const target = creative.targets.find((entry) => entry.objectIds.includes('drums'));
    const dimension = creative.dimensions.find((entry) => entry.dimension === 'arrangement');
    if (!target || !dimension) {
        throw new Error('Expected published target and arrangement dimension');
    }
    const admitted = admitPlanningInterpretation({
        creative,
        answer,
        metric,
        projectRevision: revision,
        turn: 1,
        call: {
            id: 'non-acoustic',
            name: 'selectCreativeInterpretation',
            arguments: {
                catalogId: creative.catalogId,
                modeId: 'edit',
                targetCandidateIds: [target.candidateId],
                editDimensionCandidateIds: [dimension.candidateId],
                constraintCandidateIds: [],
                creationSlotIds: [],
                uncertainty: 'none',
                answer: null,
                metricIntent: { kind: 'non-acoustic', objectives: [], uncertainty: 'none' },
            },
        },
    });
    if (admitted.status !== 'admitted') {
        throw new Error('Expected genuine non-acoustic intake');
    }
    const metricAuthority = 'metricAuthority' in admitted ? admitted.metricAuthority : undefined;
    if (admitted.kind !== 'creative' || !metricAuthority) {
        throw new Error('Expected genuine non-acoustic intake');
    }
    const commandBatch = compilePlannedActionCommandBatch({
        actions: [action],
        actionLabels: [action.type],
        autoCommit: false,
        context,
        group: { groupId: 'clip-guard', groupLabel: prompt },
        intent: prompt,
        projectRevision: revision,
        runId: 'clip-guard',
    }).commandBatch;
    let state = metricGoalStateCodec(
        JSON.stringify(
            bindMetricGoalsToBatch({
                commandBatch,
                state: {
                    schemaVersion: 1,
                    authorities: [metricAuthority],
                    steps: [],
                    proofs: [],
                    binding: null,
                },
            })
        )
    );
    if (literal) {
        state = metricGoalStateCodec(configuredLiteralMetricState(commandBatch));
    }
    if (!state) {
        throw new Error('Codec refused bound state');
    }
    return evaluateMetricGoalAdmission({ state, commandBatch, currentRevision: revision });
}

describe('non-acoustic authority and Command effects', () => {
    it('allows an arrangement-only action', () => {
        expect(
            evaluate('Rename Drums', { type: 'renameTrack', payload: { trackId: 'drums', name: 'Kit' } }).status
        ).toBe('not-required');
    });
    it('keeps a genuine brief intake and production brief command goal-free', () => {
        const prompt = 'Create a production brief';
        const revision = captureProjectRevision();
        const context = getProjectContext();
        const creative = prepareCreativeInterpretationCatalog({
            prompt,
            context,
            projectRevision: revision,
            offersBrief: true,
        });
        const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: revision });
        const metric = prepareMetricIntentCatalog({ prompt, answer });
        const admitted = admitPlanningInterpretation({
            creative,
            answer,
            metric,
            projectRevision: revision,
            turn: 1,
            call: {
                id: 'brief-intake',
                name: 'selectCreativeInterpretation',
                arguments: {
                    catalogId: creative.catalogId,
                    modeId: 'brief',
                    targetCandidateIds: [],
                    editDimensionCandidateIds: [],
                    constraintCandidateIds: [],
                    creationSlotIds: [],
                    uncertainty: 'none',
                    answer: null,
                    metricIntent: { kind: 'non-acoustic', objectives: [], uncertainty: 'none' },
                },
            },
        });
        if (admitted.status !== 'admitted') {
            throw new Error('Expected genuine brief admission');
        }
        const metricAuthority = 'metricAuthority' in admitted ? admitted.metricAuthority : undefined;
        if (admitted.kind !== 'creative' || !metricAuthority) {
            throw new Error('Expected genuine brief admission');
        }
        const brief = structuredClone(defaultProjectStoreState.productionBrief);
        const action: AppAction = {
            type: 'setProductionBrief',
            payload: {
                expectedRevision: brief.revision,
                brief: { ...brief, revision: brief.revision + 1, vision: 'Warm and close' },
            },
        };
        const commandBatch = compilePlannedActionCommandBatch({
            actions: [action],
            actionLabels: [action.type],
            autoCommit: false,
            context,
            group: { groupId: 'brief-guard', groupLabel: prompt },
            intent: prompt,
            projectRevision: revision,
            runId: 'brief-guard',
        }).commandBatch;
        const state = metricGoalStateCodec(
            JSON.stringify(
                bindMetricGoalsToBatch({
                    commandBatch,
                    state: {
                        schemaVersion: 1,
                        authorities: [metricAuthority],
                        steps: [],
                        proofs: [],
                        binding: null,
                    },
                })
            )
        );
        expect(state).not.toBeNull();
        expect(evaluateMetricGoalAdmission({ state, commandBatch, currentRevision: revision }).status).toBe(
            'not-required'
        );
    });
    it('blocks clip normalization while preserving a literal normalization', () => {
        const action: AppAction = { type: 'normalizeClip', payload: { clipId: 'intro', mode: 'lufs', targetDb: -14 } };
        const prompt = 'Normalize Intro clip on Drums to -14 LUFS';
        expect(evaluate(prompt, action)).toMatchObject({
            status: 'blocked',
            failure: 'missing',
            reason: expect.stringContaining('acoustic processing'),
        });
        expect(evaluate(prompt, action, true).status).toBe('not-required');
    });
    it('blocks tempo changes with clip-audio effects', () => {
        expect(evaluate('Set tempo to 120 BPM for Drums', { type: 'setTempo', payload: { bpm: 120 } })).toMatchObject({
            status: 'blocked',
            failure: 'missing',
            reason: expect.stringContaining('acoustic processing'),
        });
    });
});

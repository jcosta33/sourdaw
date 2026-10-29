import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
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

beforeEach(() => {
    const drums = createTrack({ id: 'drums', name: 'Drums', kind: 'audio' });
    drums.devices = [{ id: 'eq', name: 'Drums EQ', type: 'builtin-eq', bypassed: false, parameterValues: {} }];
    drums.clips = [
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
    configureMetricGoalProject({
        label: 'numeric literal accounting',
        tracks: [drums, createTrack({ id: 'bass', name: 'Bass 2400 Hz', kind: 'audio' })],
        sections: [],
    });
});

afterEach(resetMetricGoalProject);

function batch(prompt: string, action: AppAction) {
    const revision = captureProjectRevision();
    return compilePlannedActionCommandBatch({
        actions: [action],
        actionLabels: [action.type],
        autoCommit: false,
        context: getProjectContext(),
        group: { groupId: 'literal-accounting', groupLabel: prompt },
        intent: prompt,
        projectRevision: revision,
        runId: 'literal-accounting',
    }).commandBatch;
}

function literalEvaluation(prompt: string, action: AppAction) {
    const commandBatch = batch(prompt, action);
    return evaluateMetricGoalAdmission({
        state: metricGoalStateCodec(configuredLiteralMetricState(commandBatch)),
        commandBatch,
        currentRevision: captureProjectRevision(),
    });
}

describe('request-number closure through real Command metadata', () => {
    const frequencyAction: AppAction = {
        type: 'setDeviceParameter',
        payload: { deviceId: 'eq', paramId: 'eq-mid-freq', value: 2400, valueUnit: 'Hz' },
    };

    it.each(['Set Drums EQ mid frequency to 2400 Hz', 'Set drums eq mid frequency to 2400 Hz'])(
        'preserves the exact native-unit parameter edit on its named target: %s',
        (prompt) => {
            expect(literalEvaluation(prompt, frequencyAction).status).toBe('not-required');
        }
    );

    it('does not spend one parameter argument on a second acoustic obligation with the same figure', () => {
        expect(
            literalEvaluation(
                'Set Drums EQ mid frequency to 2400 Hz and keep Drums centroid at 2400 Hz',
                frequencyAction
            )
        ).toMatchObject({
            status: 'blocked',
            failure: 'missing',
            reason: expect.stringContaining('2400 Hz'),
        });
    });

    it('does not use a literal on another target to discharge the requested acoustic figure', () => {
        expect(literalEvaluation('Keep Bass centroid at 2400 Hz', frequencyAction).status).toBe('blocked');
    });

    it('requires the Command argument unit to match the request candidate', () => {
        expect(
            literalEvaluation('Set Drums EQ mid frequency to 2400 Hz', {
                ...frequencyAction,
                payload: { ...frequencyAction.payload, valueUnit: 'ms' },
            }).status
        ).toBe('blocked');
    });

    it.each(['Rename "Bass 2400 Hz" to Low Bass', 'Rename "bass 2400 Hz" to Low Bass'])(
        'preserves quoted numeric object names without inventing an acoustic goal: %s',
        (prompt) => {
            expect(
                literalEvaluation(prompt, {
                    type: 'renameTrack',
                    payload: { trackId: 'bass', name: 'Low Bass' },
                }).status
            ).toBe('not-required');
        }
    );

    it('preserves exact non-destructive clip normalization', () => {
        expect(
            literalEvaluation('Normalize Intro clip to -14 LUFS', {
                type: 'normalizeClip',
                payload: { clipId: 'intro', mode: 'lufs', targetDb: -14 },
            }).status
        ).toBe('not-required');
    });

    it('refuses a non-acoustic assertion when the actual Command changes acoustic processing', () => {
        const prompt = 'Make Drums more balanced';
        const revision = captureProjectRevision();
        const context = getProjectContext();
        const creative = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: revision });
        const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: revision });
        const metric = prepareMetricIntentCatalog({ prompt, answer });
        const target = creative.targets.find((entry) => entry.objectIds.includes('drums'));
        const dimension = creative.dimensions.find((entry) => entry.dimension === 'midi-content');
        if (target === undefined || dimension === undefined) {
            throw new TypeError('Expected actual published scope and dimension.');
        }
        const admitted = admitPlanningInterpretation({
            creative,
            answer,
            metric,
            projectRevision: revision,
            turn: 1,
            call: {
                id: 'non-acoustic-assertion',
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
        if (admitted.status !== 'admitted' || admitted.kind !== 'creative' || admitted.metricAuthority === undefined) {
            throw new TypeError('Expected genuine bounded non-acoustic intake.');
        }
        const commandBatch = batch(prompt, {
            type: 'setTrackGain',
            payload: { trackId: 'drums', gain: 0.7, expectedGain: context.tracks[0]!.gain },
        });
        const state = bindMetricGoalsToBatch({
            commandBatch,
            state: {
                schemaVersion: 1,
                authorities: [admitted.metricAuthority],
                steps: [],
                proofs: [],
                binding: null,
            },
        });
        expect(evaluateMetricGoalAdmission({ state, commandBatch, currentRevision: revision })).toMatchObject({
            status: 'blocked',
            failure: 'missing',
            reason: expect.stringContaining('acoustic processing'),
        });
    });
});

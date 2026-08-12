import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';

import { handleSetProductionBrief } from '../../handlers/project/handleSetProductionBrief';
import { createDefaultProductionBrief, isProductionBrief, type ProductionBrief } from '../../models/ProductionBrief';
import { defaultProjectStoreState, projectStore } from '../../stores/projectStore';
import { acceptCreativeIntent } from '../acceptCreativeIntent';
import { doesProductionBriefAllowActionBatch } from '../doesProductionBriefAllowActionBatch';
import { getProjectHandlers } from '../getProjectHandlers';

describe('production brief', () => {
    beforeEach(() => {
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            productionBrief: createDefaultProductionBrief(100),
        });
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('starts every project with collaborative versioned intent truth', () => {
        expect(projectStore.value).toHaveProperty('productionBrief.schemaVersion', 1);
    });

    it('rejects malformed timestamps and duplicate durable intent identities', () => {
        const current = createDefaultProductionBrief(100);
        expect(isProductionBrief({ ...current, updatedAt: 99 })).toBe(false);
        expect(
            isProductionBrief({
                ...current,
                hardConstraints: [
                    {
                        id: 'intent-1',
                        scope: { kind: 'project' },
                        statement: 'Keep the arrangement sparse',
                        createdAt: 100,
                    },
                ],
                preferences: [
                    {
                        id: 'intent-1',
                        scope: { kind: 'project' },
                        statement: 'Prefer natural dynamics',
                        createdAt: 100,
                    },
                ],
            })
        ).toBe(false);
    });

    it('commits a guarded creative decision and rejects a later rewrite of locked intent', () => {
        const current = projectStore.value!.productionBrief;
        const lockedDecision: ProductionBrief['decisions'][number] = {
            id: 'decision-vocal-space',
            scope: { kind: 'track', trackId: 'track-vocal' },
            statement: 'Keep the lead vocal dry in verses',
            rationale: 'Preserve intimacy',
            status: 'locked',
            sourceRunId: 'run-1',
            relatedBatchId: 'batch-1',
            supersededByDecisionId: null,
            createdAt: 110,
        };
        const accepted: ProductionBrief = {
            ...current,
            revision: 1,
            decisions: [lockedDecision],
            updatedAt: 110,
        };

        expect(
            handleSetProductionBrief.execute({
                type: 'setProductionBrief',
                payload: { expectedRevision: 0, brief: accepted },
            })
        ).toEqual({ status: 'written' });
        expect(projectStore.value?.productionBrief.decisions).toEqual([lockedDecision]);

        const rewritten: ProductionBrief = {
            ...accepted,
            revision: 2,
            decisions: [{ ...lockedDecision, statement: 'Make the lead vocal wide' }],
            updatedAt: 120,
        };
        expect(
            handleSetProductionBrief.execute({
                type: 'setProductionBrief',
                payload: { expectedRevision: 1, brief: rewritten },
            })
        ).toEqual({ status: 'conflict' });
        expect(projectStore.value?.productionBrief).toEqual(accepted);
    });

    it('retains accepted decision identity and requires explicit supersession', () => {
        const current = projectStore.value!.productionBrief;
        const acceptedDecision: ProductionBrief['decisions'][number] = {
            id: 'decision-vocal-space',
            scope: { kind: 'track', trackId: 'track-vocal' },
            statement: 'Keep the lead vocal dry in verses',
            rationale: 'Preserve intimacy',
            status: 'accepted',
            sourceRunId: 'run-1',
            relatedBatchId: 'batch-1',
            supersededByDecisionId: null,
            createdAt: 110,
        };
        const accepted: ProductionBrief = {
            ...current,
            revision: 1,
            decisions: [acceptedDecision],
            updatedAt: 110,
        };
        expect(
            handleSetProductionBrief.execute({
                type: 'setProductionBrief',
                payload: { expectedRevision: 0, brief: accepted },
            })
        ).toEqual({ status: 'written' });

        const rewritten: ProductionBrief = {
            ...accepted,
            revision: 2,
            decisions: [{ ...acceptedDecision, statement: 'Make the lead vocal wide' }],
            updatedAt: 120,
        };
        expect(
            handleSetProductionBrief.execute({
                type: 'setProductionBrief',
                payload: { expectedRevision: 1, brief: rewritten },
            })
        ).toEqual({ status: 'conflict' });
        expect(projectStore.value?.productionBrief).toEqual(accepted);

        const replacement: ProductionBrief['decisions'][number] = {
            id: 'decision-vocal-space-wide',
            scope: { kind: 'track', trackId: 'track-vocal' },
            statement: 'Make the lead vocal wide',
            rationale: 'Open the chorus',
            status: 'accepted',
            sourceRunId: 'run-2',
            relatedBatchId: 'batch-2',
            supersededByDecisionId: null,
            createdAt: 121,
        };
        const superseded: ProductionBrief = {
            ...accepted,
            revision: 2,
            decisions: [
                {
                    ...acceptedDecision,
                    status: 'superseded',
                    supersededByDecisionId: replacement.id,
                },
                replacement,
            ],
            updatedAt: 121,
        };
        expect(
            handleSetProductionBrief.execute({
                type: 'setProductionBrief',
                payload: { expectedRevision: 1, brief: superseded },
            })
        ).toEqual({ status: 'written' });
        expect(projectStore.value?.productionBrief.decisions).toEqual(superseded.decisions);
    });

    it('persists accepted creative intent through the application Command path', async () => {
        registerHandlerMap(getProjectHandlers());

        const decisionId = await acceptCreativeIntent({
            statement: 'Keep the lead vocal intimate',
            scope: { kind: 'track', trackId: 'track-vocal' },
            rationale: 'Preserve the close performance',
            sourceRunId: 'run-accepted-intent',
            relatedBatchId: 'batch-accepted-intent',
        });

        expect(decisionId).toMatch(/^decision-/);
        expect(projectStore.value?.productionBrief).toMatchObject({
            revision: 1,
            sourceRunLinks: ['run-accepted-intent'],
            decisions: [
                {
                    id: decisionId,
                    scope: { kind: 'track', trackId: 'track-vocal' },
                    statement: 'Keep the lead vocal intimate',
                    rationale: 'Preserve the close performance',
                    status: 'accepted',
                    sourceRunId: 'run-accepted-intent',
                    relatedBatchId: 'batch-accepted-intent',
                    supersededByDecisionId: null,
                },
            ],
        });
    });

    it('replays an approved brief revision without rewriting its locked decision', () => {
        const current = projectStore.value!.productionBrief;
        const next: ProductionBrief = {
            ...current,
            revision: 1,
            decisions: [
                {
                    id: 'decision-drums',
                    scope: { kind: 'track', trackId: 'track-drums' },
                    statement: 'Keep the drums punchy',
                    rationale: null,
                    status: 'locked',
                    sourceRunId: 'run-1',
                    relatedBatchId: 'batch-1',
                    supersededByDecisionId: null,
                    createdAt: 110,
                },
            ],
            updatedAt: 110,
        };
        const action = {
            type: 'setProductionBrief' as const,
            payload: { expectedRevision: 0, brief: next },
        };
        const description = handleSetProductionBrief.describe(action);

        expect(handleSetProductionBrief.execute(action)).toEqual({ status: 'written' });
        expect(description.inverseAction).toBeDefined();
        if (description.inverseAction?.type !== 'setProductionBrief') {
            throw new Error('Expected a production brief inverse');
        }
        expect(handleSetProductionBrief.execute(description.inverseAction)).toEqual({ status: 'written' });
        expect(projectStore.value?.productionBrief).toMatchObject({
            revision: 2,
            decisions: [],
        });
        expect(description.redoAction).toBeDefined();
        if (description.redoAction?.type !== 'setProductionBrief') {
            throw new Error('Expected a production brief redo');
        }
        expect(handleSetProductionBrief.execute(description.redoAction)).toEqual({ status: 'written' });
        expect(projectStore.value?.productionBrief).toMatchObject({
            revision: 3,
            decisions: next.decisions,
        });
    });

    it('rejects batches that target explicit locks, locked decisions, or nested protected ranges', () => {
        const current = projectStore.value!;
        projectStore.set({
            ...current,
            productionBrief: {
                ...current.productionBrief,
                locks: [
                    {
                        id: 'lock-vocal',
                        scope: { kind: 'object', objectType: 'track', objectId: 'track-vocal' },
                        statement: 'Do not alter the lead vocal',
                        createdAt: 110,
                    },
                    {
                        id: 'lock-chorus',
                        scope: { kind: 'range', startBeat: 32, endBeat: 48 },
                        statement: 'Keep Chorus One arrangement fixed',
                        createdAt: 111,
                    },
                ],
                decisions: [
                    {
                        id: 'decision-vocal-space',
                        scope: { kind: 'track', trackId: 'track-vocal' },
                        statement: 'Keep the lead vocal dry',
                        rationale: null,
                        status: 'locked',
                        sourceRunId: null,
                        relatedBatchId: null,
                        supersededByDecisionId: null,
                        createdAt: 113,
                    },
                ],
            },
        });

        expect(
            doesProductionBriefAllowActionBatch([
                { type: 'setTrackGain', payload: { trackId: 'track-vocal', gain: 0.7, expectedGain: 1 } },
            ])
        ).toBe(false);
        expect(
            doesProductionBriefAllowActionBatch([
                {
                    type: 'restoreAutomationLanePoints',
                    payload: {
                        laneId: 'lane-1',
                        points: [{ id: 'point-1', beat: 40, value: 0.7, curve: 'linear', tension: 0.5 }],
                    },
                },
            ])
        ).toBe(false);
        expect(
            doesProductionBriefAllowActionBatch([
                { type: 'moveClip', payload: { clipId: 'clip-1', trackId: 'track-drums', startBeat: 40 } },
            ])
        ).toBe(false);
        expect(
            doesProductionBriefAllowActionBatch([
                { type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 40 } },
            ])
        ).toBe(false);
        expect(
            doesProductionBriefAllowActionBatch([
                { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 40 } },
            ])
        ).toBe(false);
        expect(
            doesProductionBriefAllowActionBatch([
                { type: 'setTrackGain', payload: { trackId: 'track-guitar', gain: 0.7, expectedGain: 1 } },
            ])
        ).toBe(true);
    });
});

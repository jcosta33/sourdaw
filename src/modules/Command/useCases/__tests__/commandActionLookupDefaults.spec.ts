import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Logger } from '#/infra/logger/types';
import { type AppAction } from '#/utils/handlerContract';

import { COMMAND_APPLICATION_ID_RULES } from '../../models/CommandApplicationIdRule';
import { undoEntryStoresCommandIdByActionType } from '../../models/UndoEntryCommandIdPolicy';
import { clearHandlerRegistry } from '../../stores/handlerRegistry';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { isExecutableAppActionType } from '../executableAppActionRegistry';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { getAppActionExecutionPolicy } from '../getAppActionExecutionPolicy';
import { COMMAND_TEMPO_TARGET_ID, getCommandDivergenceTargetIds } from '../getCommandDivergenceTargetIds';
import { lowerSourceMacroAction } from '../macro/lowerSourceMacroAction';
import { materializeCommandApplicationIds } from '../materializeCommandApplicationIds';

const mocks = vi.hoisted(() => ({
    logger: {
        error: vi.fn<Logger['error']>(),
        info: vi.fn<Logger['info']>(),
        warn: vi.fn<Logger['warn']>(),
        debug: vi.fn<Logger['debug']>(),
        setWriters: vi.fn<Logger['setWriters']>(),
    } satisfies Logger,
    branchStore: { value: null, subscribe: vi.fn(() => vi.fn()) },
    actionHistoryStore: { value: null, subscribe: vi.fn(() => vi.fn()) },
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));
vi.mock('#/modules/CrdtDocument/stores', () => ({
    agentProjectRepairStateStore: { value: null },
    captureProjectIdentity: vi.fn(() => 'lookup-defaults-project'),
    setSemanticContext: vi.fn(),
    clearSemanticContext: vi.fn(),
    branchStore: mocks.branchStore,
    actionHistoryStore: mocks.actionHistoryStore,
    MAIN_BRANCH_ID: 'main',
}));

const renameTrack: AppAction = { type: 'renameTrack', payload: { trackId: 'trk', name: 'Lead' } };

describe('per-action lookups, entries an action type holds by default', () => {
    it('keeps relink internal and preserves its captured source and owner references during macro lowering', () => {
        const relink: AppAction = {
            type: 'relinkClipAudioSources',
            payload: {
                targets: [
                    {
                        trackId: 'track',
                        trackKind: 'audio',
                        activeAlternativeId: 'active',
                        alternativeId: 'inactive',
                        clipId: 'clip',
                        before: { audioBufferId: 'missing', audioOffsetSeconds: 1.25 },
                        after: { audioBufferId: 'replacement', audioOffsetSeconds: 1.25 },
                    },
                ],
            },
        };

        expect(isExecutableAppActionType(relink.type)).toBe(false);
        expect(getAppActionExecutionPolicy(relink.type)).toMatchObject({
            classification: 'default',
            risk: 'unclassified',
            requiresConfirmation: true,
        });
        expect(materializeCommandApplicationIds(relink)).toEqual({ action: relink, applicationAssignedIds: [] });
        const lowered = lowerSourceMacroAction(relink, new Map());
        expect(lowered).toEqual(relink);
        expect(lowered).not.toBe(relink);
        expect(getCommandDivergenceTargetIds({ actions: [relink], targetIds: [] })).toEqual(
            expect.arrayContaining(['track', 'clip', 'inactive'])
        );
    });

    it('mints no seed for an action that is not stochastic, and keeps the action as given', () => {
        const command = createExecutionCommandEnvelope({
            action: renameTrack,
            expectedEffect: 'Rename the track.',
            normalizedProjectRevision: 'revision-1',
        });
        expect(command.action).toBe(renameTrack);
        expect(command.envelope.seed).toBeNull();
    });

    it('mints a seed for a stochastic action and keeps one the caller supplied', () => {
        const minted = createExecutionCommandEnvelope({
            action: { type: 'humanizeNotes', payload: { clipId: 'clip', amount: 0.5 } },
            expectedEffect: 'Humanize.',
            normalizedProjectRevision: 'revision-1',
        });
        expect(typeof minted.envelope.seed).toBe('number');
        const supplied = createExecutionCommandEnvelope({
            action: { type: 'humanizeNotes', payload: { clipId: 'clip', amount: 0.5, seed: 7 } },
            expectedEffect: 'Humanize.',
            normalizedProjectRevision: 'revision-1',
        });
        expect(supplied.envelope.seed).toBe(7);
    });

    it('adds no divergence target beyond the arguments for an action with no project slot', () => {
        expect(getCommandDivergenceTargetIds({ actions: [renameTrack], targetIds: [] })).toEqual(['trk']);
        expect(
            getCommandDivergenceTargetIds({ actions: [{ type: 'setTempo', payload: { bpm: 120 } }], targetIds: [] })
        ).toEqual([COMMAND_TEMPO_TARGET_ID]);
    });

    it('replays an action with no lowering rule as a copy of the recorded one', () => {
        const replay = lowerSourceMacroAction(renameTrack, new Map());
        expect(replay).toEqual(renameTrack);
        expect(replay).not.toBe(renameTrack);
    });

    it('assigns no application id to an action with no id rule', () => {
        expect(COMMAND_APPLICATION_ID_RULES.renameTrack).toBeNull();
        expect(materializeCommandApplicationIds(renameTrack)).toEqual({
            action: renameTrack,
            applicationAssignedIds: [],
        });
    });

    it('mints the rule id of an action that has one', () => {
        const materialized = materializeCommandApplicationIds({
            type: 'addMarker',
            payload: { beat: 1, name: 'A' },
        });
        expect(materialized.applicationAssignedIds).toEqual([
            { argument: 'markerId', value: expect.stringMatching(/^marker-command-/) },
        ]);
    });

    it('stores the command id in an undo entry only for removeClip and splitClip', () => {
        expect(undoEntryStoresCommandIdByActionType.removeClip).toBe(true);
        expect(undoEntryStoresCommandIdByActionType.splitClip).toBe(true);
        expect(undoEntryStoresCommandIdByActionType.renameTrack).toBe(false);
    });
});

// Undo entries, saved macros and legacy envelopes can carry a type no handler map holds; the
// parse is the only way to build one without a cast.
function unknownTypeAction(type: string): AppAction {
    const parsed: AppAction = JSON.parse(`{"type":"${type}","payload":{}}`);
    return parsed;
}

const unknownTypes = ['retiredAction', 'constructor', 'toString', '__proto__'];

describe('kernel action lookups for types no handler registers', () => {
    beforeEach(() => {
        clearHandlerRegistry();
    });

    it.each(unknownTypes)('materializes %s unchanged with no assigned ids', (type) => {
        const action = unknownTypeAction(type);

        const result = materializeCommandApplicationIds(action);

        expect(result.action).toBe(action);
        expect(result.applicationAssignedIds).toEqual([]);
    });

    // The handler registry's own lookup is not an own-property read, so inherited names are
    // outside this spec; a retired name is the case the kernel records alone decide.
    it('rejects a batch holding a retired type as having no handler', async () => {
        const result = await executeAppActionBatch([unknownTypeAction('retiredAction')], {
            groupId: 'lookup-defaults',
            groupLabel: 'Lookup defaults',
            source: 'manual',
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'No registered handler for action: retiredAction',
            actions: [],
        });
    });

    it.each(unknownTypes)('lowers %s to a clone the dispatcher can refuse', (type) => {
        const action = unknownTypeAction(type);

        const lowered = lowerSourceMacroAction(action, new Map());

        expect(lowered).toEqual(action);
        expect(lowered).not.toBe(action);
    });
});

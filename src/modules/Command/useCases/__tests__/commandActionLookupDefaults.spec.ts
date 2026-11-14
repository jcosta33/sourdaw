import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { COMMAND_APPLICATION_ID_RULES } from '../../models/CommandApplicationIdRule';
import { undoEntryStoresCommandIdByActionType } from '../../models/UndoEntryCommandIdPolicy';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { COMMAND_TEMPO_TARGET_ID, getCommandDivergenceTargetIds } from '../getCommandDivergenceTargetIds';
import { lowerSourceMacroAction } from '../macro/lowerSourceMacroAction';
import { materializeCommandApplicationIds } from '../materializeCommandApplicationIds';

const renameTrack: AppAction = { type: 'renameTrack', payload: { trackId: 'trk', name: 'Lead' } };

describe('per-action lookups, entries an action type holds by default', () => {
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

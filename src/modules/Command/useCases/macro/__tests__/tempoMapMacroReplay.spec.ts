import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tempoMapStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { AppActionConflictError } from '../../../errors/AppActionExecutionError';
import { clearHandlerRegistry, registerHandlerMap } from '../../../stores/handlerRegistry';
import { replayTempoMapMacroAction } from '../tempoMapMacroReplay';

const { execute } = vi.hoisted(() => ({ execute: vi.fn<typeof import('../../executeAppAction').executeAppAction>() }));
vi.mock('../../executeAppAction', () => ({ executeAppAction: execute }));

type Restore = Extract<AppAction, { type: 'restoreTempoMapEdit' }>;
const promotion: Restore['payload']['audioSourcePromotion'] = {
    version: 1,
    clips: [],
    takes: [],
    regions: [],
    gaps: [],
    gapFieldPresence: [],
};
function inverseRemove(): Restore {
    return {
        type: 'restoreTempoMapEdit',
        payload: {
            rowPlan: {
                operation: 'remove',
                before: [{ id: 'recorded', beat: 4, tempo: 90, curve: 'instant' }],
                after: [],
                order: [{ beat: 4, before: ['recorded'], after: [] }],
            },
            rowDirection: 'restore',
            sourceDirection: 'restore',
            audioSourcePromotion: promotion,
        },
    };
}
function admittedAdd(): AppAction {
    return {
        type: 'editTempoMap',
        payload: {
            edit: { type: 'add', beat: 4, tempo: 90 },
            rowPlan: {
                operation: 'add',
                before: [],
                after: [{ id: 'actual', beat: 4, tempo: 90, curve: 'instant' }],
                order: [{ beat: 4, before: [], after: ['actual'] }],
                collision: { beat: 4, targetId: null },
            },
            audioSourcePromotion: promotion,
        },
    };
}

describe('macro tempo row aliases use admitted arguments only after success', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        execute.mockReset();
        tempoMapStore.set({ changes: [] });
    });
    afterEach(() => {
        clearHandlerRegistry();
    });

    it('rebinds older aliases after an inverse add creates a new actual row', async () => {
        const ids = new Map([
            ['older-alias', 'previous'],
            ['recorded', 'previous'],
        ]);
        execute.mockImplementation(async (_action, options) => {
            options?.observeMaterializedAction?.(admittedAdd());
        });
        await replayTempoMapMacroAction(inverseRemove(), ids, {});
        expect(ids).toEqual(
            new Map([
                ['older-alias', 'actual'],
                ['recorded', 'actual'],
            ])
        );
        expect(execute.mock.calls[0]?.[0]).toEqual({
            type: 'editTempoMap',
            payload: { edit: { type: 'add', beat: 4, tempo: 90, curve: 'instant' } },
        });
    });

    it('does not publish aliases from an observed action whose dispatch later fails', async () => {
        const ids = new Map([['recorded', 'previous']]);
        execute.mockImplementation(async (_action, options) => {
            options?.observeMaterializedAction?.(admittedAdd());
            throw new AppActionConflictError('editTempoMap');
        });
        await expect(replayTempoMapMacroAction(inverseRemove(), ids, {})).rejects.toBeInstanceOf(
            AppActionConflictError
        );
        expect(ids).toEqual(new Map([['recorded', 'previous']]));
    });

    it('does not bind an action cancelled before owner admission', async () => {
        execute.mockResolvedValue(undefined);
        const ids = new Map([['recorded', 'previous']]);
        await replayTempoMapMacroAction(inverseRemove(), ids, {});
        expect(ids).toEqual(new Map([['recorded', 'previous']]));
    });

    it('uses the real planner collision owner when a successful add is a noop', async () => {
        tempoMapStore.set({ changes: [{ id: 'collision-owner', beat: 4, tempo: 90, curve: 'instant' }] });
        execute.mockImplementation(async (_action, options) => {
            options?.observeMaterializedAction?.({
                type: 'editTempoMap',
                payload: { edit: { type: 'add', beat: 4, tempo: 90, curve: 'instant' } },
            });
            // A later replacement must not become the earlier noop's owner.
            tempoMapStore.set({ changes: [{ id: 'later-owner', beat: 4, tempo: 90, curve: 'instant' }] });
        });
        const ids = new Map<string, string>();
        await replayTempoMapMacroAction(inverseRemove(), ids, {});
        expect(ids.get('recorded')).toBe('collision-owner');
    });

    it('refuses malformed captured owners through the registered actual codec', async () => {
        const action = inverseRemove();
        action.payload.rowPlan = {
            ...action.payload.rowPlan,
            before: [{ id: '', beat: 4, tempo: 90, curve: 'instant' }],
        };
        await expect(replayTempoMapMacroAction(action, new Map(), {})).rejects.toBeInstanceOf(AppActionConflictError);
        expect(execute).not.toHaveBeenCalled();
    });

    it.each(['non-noop', 'missing-owner'] as const)('does not bind an unqualified %s target', async (condition) => {
        tempoMapStore.set({ changes: [{ id: 'different-owner', beat: 4, tempo: 100, curve: 'instant' }] });
        execute.mockImplementation(async (_action, options) => {
            if (condition === 'missing-owner') {
                clearHandlerRegistry();
            }
            options?.observeMaterializedAction?.({
                type: 'editTempoMap',
                payload: { edit: { type: 'add', beat: 4, tempo: 90, curve: 'instant' } },
            });
        });
        const ids = new Map([['recorded', 'previous']]);
        await replayTempoMapMacroAction(inverseRemove(), ids, {});
        expect(ids).toEqual(new Map([['recorded', 'previous']]));
    });
});

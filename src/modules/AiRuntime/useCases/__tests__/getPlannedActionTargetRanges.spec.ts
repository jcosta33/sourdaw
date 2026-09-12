import { afterEach, describe, expect, it } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { type AppAction } from '#/utils/handlerContract';

import { getPlannedActionTargetRanges } from '../getPlannedActionTargetRanges';

type SetEditingToolAction = Extract<AppAction, { type: 'setEditingTool' }>;

describe('getPlannedActionTargetRanges', () => {
    afterEach(() => {
        clearHandlerRegistry();
    });

    it('materializes each measurement with the full ordered action context', () => {
        const actions: SetEditingToolAction[] = [
            { type: 'setEditingTool', payload: { tool: 'select' } },
            { type: 'setEditingTool', payload: { tool: 'marquee' } },
        ];
        const observed: Array<{ actions: readonly AppAction[]; actionIndex: number }> = [];
        registerHandlerMap({
            setEditingTool: {
                describe: () => ({ label: 'Set editing tool' }),
                execute: () => undefined,
                materializeCommandArguments: (_action, context) => {
                    if (context) {
                        observed.push(context);
                    }
                },
                undoable: false,
            },
        });

        expect(getPlannedActionTargetRanges(actions)).toEqual([]);
        expect(observed).toEqual([
            { actions, actionIndex: 0 },
            { actions, actionIndex: 1 },
        ]);
    });
});

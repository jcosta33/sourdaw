import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest';

import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, getHandler, getHandlerMap, registerHandlerMap } from '../handlerRegistry';

// A minimal stub handler; the registry never invokes it in these tests.
function stub(label: string): ActionHandler {
    return {
        undoable: false,
        execute: () => {},
        describe: () => ({ label }),
    };
}

function typedHandler<ActionType extends AppAction['type']>(
    actionType: ActionType,
    execute: (action: Extract<AppAction, { type: ActionType }>) => void
): ActionHandler<Extract<AppAction, { type: ActionType }>> {
    return {
        undoable: false,
        execute,
        describe: () => ({ label: actionType }),
    };
}

describe('handlerRegistry / registerHandlerMap', () => {
    beforeEach(() => {
        clearHandlerRegistry();
    });

    it('merges disjoint handler maps into one registry', () => {
        registerHandlerMap({ togglePlayback: stub('a') });
        registerHandlerMap({ stopPlayback: stub('b') });

        const map = getHandlerMap();
        expect(Object.keys(map).sort()).toEqual(['stopPlayback', 'togglePlayback']);
    });

    it('keeps action discriminants through registration and lookup', async () => {
        const executions: string[] = [];
        const toggleHandler = typedHandler('togglePlayback', (action) => {
            executions.push(action.type);
        });
        const tempoHandler = typedHandler('setTempo', (action) => {
            executions.push(`${action.type}:${action.payload.bpm}`);
        });

        registerHandlerMap({ togglePlayback: toggleHandler });
        registerHandlerMap({ setTempo: tempoHandler });

        const toggleAction = { type: 'togglePlayback' } satisfies Extract<AppAction, { type: 'togglePlayback' }>;
        const tempoAction = {
            type: 'setTempo',
            payload: { bpm: 120 },
        } satisfies Extract<AppAction, { type: 'setTempo' }>;

        expectTypeOf(getHandler(toggleAction)).toEqualTypeOf<typeof toggleHandler | undefined>();
        expectTypeOf(getHandler(tempoAction)).toEqualTypeOf<typeof tempoHandler | undefined>();

        await getHandler(toggleAction)?.execute(toggleAction);
        await getHandler(tempoAction)?.execute(tempoAction);

        expect(executions).toEqual(['togglePlayback', 'setTempo:120']);
    });

    it('throws on a duplicate action-type registration (one handler per action type)', () => {
        registerHandlerMap({ togglePlayback: stub('first') });

        expect(() => registerHandlerMap({ togglePlayback: stub('second') })).toThrow(
            /Duplicate handler for action type: togglePlayback/
        );
    });

    it('throws on a duplicate even when it is in the same registration batch as a new key', () => {
        registerHandlerMap({ togglePlayback: stub('first') });

        expect(() => registerHandlerMap({ stopPlayback: stub('new'), togglePlayback: stub('dup') })).toThrow(
            /Duplicate handler for action type: togglePlayback/
        );
    });

    it('does not let a rejected duplicate overwrite the first registration', () => {
        const first = stub('first');
        registerHandlerMap({ togglePlayback: first });
        try {
            registerHandlerMap({ togglePlayback: stub('second') });
        } catch {
            /* expected */
        }
        expect(getHandlerMap().togglePlayback).toBe(first);
    });
});

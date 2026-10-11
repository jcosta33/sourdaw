import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { type AbortCompensation, compensateAbortedActions } from '../compensateAbortedActions';

import type { ActionHandler, AppAction, HandlerExecutionResult } from '#/utils/handlerContract';

type SetEditingToolAction = Extract<AppAction, { type: 'setEditingTool' }>;
type InverseOutcome = void | HandlerExecutionResult;

const passThroughScope = <Result>(callback: () => Result): Result => callback();

function inverseOf(tool: string): SetEditingToolAction {
    return { type: 'setEditingTool', payload: { tool } };
}

function attempted(
    name: string,
    overrides: Partial<Pick<AbortCompensation, 'requiresAbortCompensation' | 'inverseAction'>> = {}
): AbortCompensation {
    return {
        actionType: name,
        requiresAbortCompensation: true,
        inverseAction: inverseOf(`inverse-${name}`),
        commandId: `command-${name}`,
        groupId: undefined,
        ...overrides,
    };
}

// Every inverse is a `setEditingTool` whose tool names the action it undoes, so one
// handler records which inverses ran and in what order.
function registerInverseHandler(replayed: string[], outcomes: Readonly<Record<string, InverseOutcome>> = {}): void {
    registerHandlerMap({
        setEditingTool: {
            undoable: true,
            describe: (described) => ({ label: `Inverse ${described.payload.tool}` }),
            execute: (executed) => {
                replayed.push(executed.payload.tool);
                return outcomes[executed.payload.tool];
            },
        } satisfies ActionHandler<SetEditingToolAction>,
    });
}

describe('compensateAbortedActions', () => {
    beforeEach(() => {
        clearHandlerRegistry();
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('replays the inverses last attempted first', async () => {
        const replayed: string[] = [];
        registerInverseHandler(replayed);

        const failure = await compensateAbortedActions(
            [attempted('first'), attempted('second'), attempted('third')],
            passThroughScope
        );

        expect(failure).toBeNull();
        expect(replayed).toEqual(['inverse-third', 'inverse-second', 'inverse-first']);
    });

    it('skips an action that does not require abort compensation and replays the rest in order', async () => {
        const replayed: string[] = [];
        registerInverseHandler(replayed);

        const failure = await compensateAbortedActions(
            [attempted('first'), attempted('second', { requiresAbortCompensation: false }), attempted('third')],
            passThroughScope
        );

        expect(failure).toBeNull();
        expect(replayed).toEqual(['inverse-third', 'inverse-first']);
    });

    it('replays nothing when no attempted action requires abort compensation', async () => {
        const replayed: string[] = [];
        registerInverseHandler(replayed);

        const failure = await compensateAbortedActions(
            [attempted('first', { requiresAbortCompensation: false })],
            passThroughScope
        );

        expect(failure).toBeNull();
        expect(replayed).toEqual([]);
    });

    it.each<{ name: string; outcome: HandlerExecutionResult }>([
        { name: 'conflict', outcome: { status: 'conflict' } },
        { name: 'no-write', outcome: { status: 'no-write' } },
    ])('stops at the first inverse that reports $name and leaves the earlier ones unreplayed', async ({ outcome }) => {
        const replayed: string[] = [];
        registerInverseHandler(replayed, { 'inverse-second': outcome });

        const failure = await compensateAbortedActions(
            [attempted('first'), attempted('second'), attempted('third')],
            passThroughScope
        );

        expect(failure).toBe('Runtime compensation did not apply for setEditingTool');
        expect(replayed).toEqual(['inverse-third', 'inverse-second']);
    });

    it('stops at an action that holds no inverse and returns that reason', async () => {
        const replayed: string[] = [];
        registerInverseHandler(replayed);

        const failure = await compensateAbortedActions(
            [attempted('first'), attempted('second', { inverseAction: null }), attempted('third')],
            passThroughScope
        );

        expect(failure).toBe('No inverse action available for second');
        expect(replayed).toEqual(['inverse-third']);
    });

    it('stops at an inverse that throws and returns its message', async () => {
        const replayed: string[] = [];
        registerHandlerMap({
            setEditingTool: {
                undoable: true,
                describe: () => ({ label: 'Inverse' }),
                execute: (executed) => {
                    replayed.push(executed.payload.tool);
                    if (executed.payload.tool === 'inverse-third') {
                        throw new Error('third inverse broke');
                    }
                },
            } satisfies ActionHandler<SetEditingToolAction>,
        });

        const failure = await compensateAbortedActions([attempted('first'), attempted('third')], passThroughScope);

        expect(failure).toBe('third inverse broke');
        expect(replayed).toEqual(['inverse-third']);
    });
});

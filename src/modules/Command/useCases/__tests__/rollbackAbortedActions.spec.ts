import { describe, expect, it } from 'vitest';

import { rollbackAbortedActions } from '../rollbackAbortedActions';

import type { HandlerAfterCommit } from '#/utils/handlerContract';

type Attempted = { readonly actionType: string; readonly rollback: HandlerAfterCommit | null };

const passThroughScope = <Result>(callback: () => Result): Result => callback();

function recordingRollback(calls: string[], name: string, failure?: Error): HandlerAfterCommit {
    return () => {
        calls.push(name);
        if (failure) {
            throw failure;
        }
    };
}

describe('rollbackAbortedActions', () => {
    it('runs the rollbacks last attempted first', async () => {
        const calls: string[] = [];
        const attempted: Attempted[] = [
            { actionType: 'first', rollback: recordingRollback(calls, 'first') },
            { actionType: 'second', rollback: recordingRollback(calls, 'second') },
            { actionType: 'third', rollback: recordingRollback(calls, 'third') },
        ];

        const failure = await rollbackAbortedActions(attempted, passThroughScope);

        expect(failure).toBeNull();
        expect(calls).toEqual(['third', 'second', 'first']);
    });

    it('does not reorder the caller attempted list', async () => {
        const calls: string[] = [];
        const attempted: readonly Attempted[] = [
            { actionType: 'first', rollback: recordingRollback(calls, 'first') },
            { actionType: 'second', rollback: recordingRollback(calls, 'second') },
        ];

        await rollbackAbortedActions(attempted, passThroughScope);

        expect(attempted.map(({ actionType }) => actionType)).toEqual(['first', 'second']);
    });

    it('skips an attempted action that captured no rollback and still runs the rest in order', async () => {
        const calls: string[] = [];
        const attempted: Attempted[] = [
            { actionType: 'first', rollback: recordingRollback(calls, 'first') },
            { actionType: 'second', rollback: null },
            { actionType: 'third', rollback: recordingRollback(calls, 'third') },
        ];

        const failure = await rollbackAbortedActions(attempted, passThroughScope);

        expect(failure).toBeNull();
        expect(calls).toEqual(['third', 'first']);
    });

    it('runs every earlier rollback after a failed one and joins all failures with a semicolon', async () => {
        const calls: string[] = [];
        const attempted: Attempted[] = [
            { actionType: 'first', rollback: recordingRollback(calls, 'first', new Error('first broke')) },
            { actionType: 'second', rollback: recordingRollback(calls, 'second') },
            { actionType: 'third', rollback: recordingRollback(calls, 'third', new Error('third broke')) },
            { actionType: 'fourth', rollback: recordingRollback(calls, 'fourth') },
        ];

        const failure = await rollbackAbortedActions(attempted, passThroughScope);

        expect(calls).toEqual(['fourth', 'third', 'second', 'first']);
        expect(failure).toBe('third: third broke; first: first broke');
    });

    it('runs each rollback inside the scope it was given', async () => {
        const events: string[] = [];
        const scope = <Result>(callback: () => Result): Result => {
            events.push('enter');
            const result = callback();
            events.push('exit');
            return result;
        };
        const attempted: Attempted[] = [
            {
                actionType: 'first',
                rollback: () => {
                    events.push('first');
                },
            },
            {
                actionType: 'second',
                rollback: () => {
                    events.push('second');
                },
            },
        ];

        await rollbackAbortedActions(attempted, scope);

        expect(events).toEqual(['enter', 'second', 'exit', 'enter', 'first', 'exit']);
    });
});

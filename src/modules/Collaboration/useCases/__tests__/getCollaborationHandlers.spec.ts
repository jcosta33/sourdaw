import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createSession: vi.fn(),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
    runWithAutomergeStorageTransaction: vi.fn(),
    loggerError: vi.fn(),
}));

vi.mock('#/infra/di/inject', () => ({
    inject: (deps: Record<string, unknown>) => (factory: (d: Record<string, unknown>) => unknown) =>
        factory(
            Object.fromEntries(
                Object.entries(deps).map(([key]) => {
                    if (key === 'logger') {
                        return [key, { error: mocks.loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }];
                    }
                    return [key, { emit: vi.fn(), on: vi.fn(() => () => {}) }];
                })
            )
        ),
}));
vi.mock('#/utils/createHandler', () => ({ createHandler: (config: unknown) => config }));
vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/infra/store/storage/createAutomergeStorage')>();
    return { ...actual, runWithAutomergeStorageTransaction: mocks.runWithAutomergeStorageTransaction };
});
vi.mock('../collaboration/createSession', () => ({ createSession: mocks.createSession }));
vi.mock('../collaboration/joinSession', () => ({ joinSession: mocks.joinSession }));
vi.mock('../collaboration/leaveSession', () => ({ leaveSession: mocks.leaveSession }));

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeAppAction, executeAppActionBatch } from '#/modules/Command/useCases';

import { handleCreateCollabSession } from '../../handlers/collaboration/handleCreateCollabSession';
import { handleJoinCollabSession } from '../../handlers/collaboration/handleJoinCollabSession';
import { handleLeaveCollabSession } from '../../handlers/collaboration/handleLeaveCollabSession';
import { getCollaborationHandlers } from '../getCollaborationHandlers';

function createObservedThenable<Result>() {
    const operation = Promise.withResolvers<Result>();
    const awaited = Promise.withResolvers<void>();
    const promise = {
        then: <Resolved = Result, Rejected = never>(
            onFulfilled?: ((value: Result) => Resolved | PromiseLike<Resolved>) | null,
            onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null
        ) => {
            awaited.resolve();
            return operation.promise.then(onFulfilled, onRejected);
        },
    } as Promise<Result>;
    return { operation, awaited: awaited.promise, promise };
}

describe('getCollaborationHandlers', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        vi.clearAllMocks();
        mocks.createSession.mockResolvedValue('session-id');
        mocks.joinSession.mockResolvedValue('answer');
        mocks.leaveSession.mockResolvedValue(undefined);
        registerHandlerMap(getCollaborationHandlers());
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('maps each collaboration action type to its own dedicated handler', () => {
        const handlers = getCollaborationHandlers();

        expect(handlers.createCollabSession).toBe(handleCreateCollabSession);
        expect(handlers.joinCollabSession).toBe(handleJoinCollabSession);
        expect(handlers.leaveCollabSession).toBe(handleLeaveCollabSession);
    });

    it('exposes exactly the three collaboration action types and no others', () => {
        const handlers = getCollaborationHandlers();

        expect(Object.keys(handlers).sort()).toEqual(
            ['createCollabSession', 'joinCollabSession', 'leaveCollabSession'].sort()
        );
    });

    it.each([
        {
            name: 'create',
            action: { type: 'createCollabSession' as const, payload: { name: 'Host' } },
            dependency: mocks.createSession,
            resolved: 'session-id',
        },
        {
            name: 'join',
            action: { type: 'joinCollabSession' as const, payload: { inviteString: 'invite', peerName: 'Peer' } },
            dependency: mocks.joinSession,
            resolved: 'answer',
        },
        {
            name: 'leave',
            action: { type: 'leaveCollabSession' as const, payload: undefined },
            dependency: mocks.leaveSession,
            resolved: undefined,
        },
    ])(
        'awaits registered $name completion without opening a project transaction',
        async ({ action, dependency, resolved }) => {
            const held = createObservedThenable<unknown>();
            dependency.mockReturnValueOnce(held.promise);

            const execution = executeAppAction(action);
            await held.awaited;

            expect(mocks.runWithAutomergeStorageTransaction).not.toHaveBeenCalled();

            held.operation.resolve(resolved);
            await execution;
            expect(mocks.runWithAutomergeStorageTransaction).not.toHaveBeenCalled();
        }
    );

    it.each([
        {
            name: 'create',
            action: { type: 'createCollabSession' as const, payload: { name: 'Host' } },
            dependency: mocks.createSession,
        },
        {
            name: 'join',
            action: { type: 'joinCollabSession' as const, payload: { inviteString: 'invite', peerName: 'Peer' } },
            dependency: mocks.joinSession,
        },
        {
            name: 'leave',
            action: { type: 'leaveCollabSession' as const, payload: undefined },
            dependency: mocks.leaveSession,
        },
    ])(
        'propagates the original registered $name failure without a project rollback',
        async ({ action, dependency }) => {
            const failure = new Error(`${action.type} failed`);
            dependency.mockRejectedValueOnce(failure);

            await expect(executeAppAction(action)).rejects.toBe(failure);
            expect(mocks.runWithAutomergeStorageTransaction).not.toHaveBeenCalled();
        }
    );

    it('awaits singleton-batch teardown and reports its failure without a project rollback', async () => {
        const teardown = createObservedThenable<void>();
        mocks.leaveSession.mockReturnValueOnce(teardown.promise);

        const execution = executeAppActionBatch([{ type: 'leaveCollabSession', payload: undefined }]);
        await teardown.awaited;

        expect(mocks.runWithAutomergeStorageTransaction).not.toHaveBeenCalled();

        teardown.operation.resolve();
        await expect(execution).resolves.toMatchObject({ status: 'executed' });
        expect(mocks.runWithAutomergeStorageTransaction).not.toHaveBeenCalled();

        const failure = new Error('batch teardown failed');
        mocks.leaveSession.mockRejectedValueOnce(failure);
        await expect(executeAppActionBatch([{ type: 'leaveCollabSession', payload: undefined }])).resolves.toEqual({
            status: 'failed',
            reason: failure.message,
            actions: [],
        });
        expect(mocks.runWithAutomergeStorageTransaction).not.toHaveBeenCalled();
    });
});

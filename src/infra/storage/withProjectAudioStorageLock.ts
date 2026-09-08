import { inject } from '#/infra/di/inject';

const PROJECT_AUDIO_STORAGE_LOCK_NAME = 'sourdaw:project-audio-storage';

declare const projectAudioStorageLockScopeBrand: unique symbol;

export type ProjectAudioStorageLockScope = {
    readonly [projectAudioStorageLockScopeBrand]: true;
};

type ProjectAudioStorageLockScopeState = {
    active: boolean;
    pending: Set<Promise<unknown>>;
};

const scopeStateByToken = new WeakMap<object, ProjectAudioStorageLockScopeState>();

function resolveLockManager(): LockManager | undefined {
    return globalThis.navigator?.locks;
}

/** Run nested storage work through a scope minted by the active named lock. */
export async function runInProjectAudioStorageLock<TResult>(
    scope: ProjectAudioStorageLockScope,
    operation: () => Promise<TResult>
): Promise<TResult> {
    const state = scopeStateByToken.get(scope);
    if (!state?.active) {
        throw new Error('Project audio storage lock scope is invalid or expired');
    }
    let pending: Promise<TResult>;
    try {
        pending = Promise.resolve(operation());
    } catch (error) {
        pending = Promise.reject(error);
    }
    state.pending.add(pending);
    void pending.then(
        () => state.pending.delete(pending),
        () => state.pending.delete(pending)
    );
    return pending;
}

async function closeScopeAfterNestedOperations(state: ProjectAudioStorageLockScopeState): Promise<void> {
    for (;;) {
        const pending = [...state.pending];
        if (pending.length === 0) {
            state.active = false;
            return;
        }
        await Promise.allSettled(pending);
    }
}

/** Serializes named-project publication with every primary-audio storage mutation. */
export const withProjectAudioStorageLock = inject({ resolveLockManager })(
    ({ resolveLockManager }) =>
        async function withProjectAudioStorageLock<TResult>(
            operation: (scope: ProjectAudioStorageLockScope) => Promise<TResult>
        ): Promise<TResult> {
            const locks = resolveLockManager();
            if (locks === undefined) {
                throw new Error('Project audio storage requires the Web Locks API');
            }
            return locks.request(PROJECT_AUDIO_STORAGE_LOCK_NAME, { mode: 'exclusive' }, async () => {
                const token = Object.freeze({}) as ProjectAudioStorageLockScope;
                const state: ProjectAudioStorageLockScopeState = { active: true, pending: new Set() };
                scopeStateByToken.set(token, state);
                try {
                    return await operation(token);
                } finally {
                    await closeScopeAfterNestedOperations(state);
                    scopeStateByToken.delete(token);
                }
            });
        }
);

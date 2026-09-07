import { inject } from '#/infra/di/inject';

const PROJECT_AUDIO_STORAGE_LOCK_NAME = 'sourdaw:project-audio-storage';

function resolveLockManager(): LockManager | undefined {
    return globalThis.navigator?.locks;
}

/** Serializes named-project publication with destructive primary-audio storage operations. */
export const withProjectAudioStorageLock = inject({ resolveLockManager })(
    ({ resolveLockManager }) =>
        async function withProjectAudioStorageLock<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
            const locks = resolveLockManager();
            if (locks === undefined) {
                throw new Error('Project audio storage requires the Web Locks API');
            }
            return locks.request(PROJECT_AUDIO_STORAGE_LOCK_NAME, { mode: 'exclusive' }, operation);
        }
);

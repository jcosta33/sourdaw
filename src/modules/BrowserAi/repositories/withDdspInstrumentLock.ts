import { inject } from '#/infra/di/inject';

export type DdspInstrumentLockMode = 'exclusive' | 'shared';

/** Coordinates one instrument's readers and generation transitions across every same-origin renderer. */
export const withDdspInstrumentLock = inject({ locks: globalThis.navigator?.locks })(
    ({ locks }) =>
        async function withDdspInstrumentLock<TResult>(
            instrumentId: string,
            mode: DdspInstrumentLockMode,
            operation: () => Promise<TResult>,
            signal?: AbortSignal
        ): Promise<TResult> {
            if (locks === undefined) {
                throw new Error('DDSP storage requires the Web Locks API');
            }
            const options: LockOptions = signal === undefined ? { mode } : { mode, signal };
            return locks.request(`sourdaw:ddsp:${instrumentId}`, options, operation);
        }
);

import { inject } from '#/infra/di/inject';

export type DdspInstrumentLockMode = 'exclusive' | 'shared';

/** Coordinates one instrument's readers and generation transitions across every same-origin renderer. */
export const withDdspInstrumentLock = inject({ locks: globalThis.navigator?.locks })(
    ({ locks }) =>
        async function withDdspInstrumentLock<TResult>(
            instrumentId: string,
            mode: DdspInstrumentLockMode,
            operation: () => Promise<TResult>
        ): Promise<TResult> {
            if (locks === undefined) {
                throw new Error('DDSP storage requires the Web Locks API');
            }
            return locks.request(`sourdaw:ddsp:${instrumentId}`, { mode }, operation);
        }
);

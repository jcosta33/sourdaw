import { inject } from '#/infra/di/inject';

export type DdspInstrumentLockMode = 'shared' | 'exclusive';

/** Coordinates DDSP readers and generation transitions across same-origin renderers. */
export const withDdspInstrumentLock = inject({
    locks: globalThis.navigator?.locks,
})(
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

import { inject } from '#/infra/di/inject';

type WebLocks = Pick<LockManager, 'request'>;

/** Serializes every DDSP generation transition across same-origin renderers. */
export const withDdspInstrumentLock = inject({
    locks: globalThis.navigator?.locks as WebLocks | undefined,
})(
    ({ locks }) =>
        async function withDdspInstrumentLock<T>(instrumentId: string, operation: () => Promise<T>): Promise<T> {
            if (locks === undefined) {
                throw new Error('DDSP storage requires the Web Locks API');
            }
            return locks.request(`sourdaw:ddsp:${instrumentId}`, { mode: 'exclusive' }, operation);
        }
);

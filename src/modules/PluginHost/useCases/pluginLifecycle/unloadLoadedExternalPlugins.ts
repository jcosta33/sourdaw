import { loadedExternalInstances } from './loadedExternalInstances';
import { unloadPlugin } from './unloadPlugin';

function normalizeUnloadFailure(failure: PromiseRejectedResult): Error {
    const reason: unknown = failure.reason;
    return reason instanceof Error ? reason : new Error('External plugin unload failed', { cause: reason });
}

/** Unload every native external-plugin instance owned by the current graph. */
export async function unloadLoadedExternalPlugins(): Promise<void> {
    const results = await Promise.allSettled(
        [...loadedExternalInstances].map((instanceId) => unloadPlugin(instanceId))
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
        throw new AggregateError(
            failures.map(normalizeUnloadFailure),
            'Failed to unload all external plugin instances'
        );
    }
}

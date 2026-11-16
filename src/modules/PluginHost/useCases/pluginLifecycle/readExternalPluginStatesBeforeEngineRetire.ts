import { commitCarriedLiveStates } from './commitCarriedLiveStates';
import { loadedExternalInstances } from './loadedExternalInstances';
import { readLiveStatesForTeardown } from './readLiveStatesForTeardown';

/**
 * Read every loaded instance's live state before a native engine retire drops
 * the plugin runtimes. The caller commits with the ids the retire reports it
 * destroyed, and only when it did retire.
 */
export async function readExternalPluginStatesBeforeEngineRetire(): Promise<{
    readonly commit: (retiredInstanceIds: readonly string[]) => void;
}> {
    const reads = await readLiveStatesForTeardown([...loadedExternalInstances], 'scheduled');
    return { commit: (retiredInstanceIds) => commitCarriedLiveStates(reads, retiredInstanceIds) };
}

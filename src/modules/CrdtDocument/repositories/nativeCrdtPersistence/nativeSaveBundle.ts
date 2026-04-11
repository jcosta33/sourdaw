import { invokeCommand } from './helpers';

/** Save all CRDT documents to a native .sdaw file. */
export const nativeSaveBundle = async (path: string): Promise<boolean> => {
    const result = await invokeCommand('collab_save_bundle', { path });
    return Boolean(result);
};
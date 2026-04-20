import { invokeCommand } from './helpers';

/** Apply a serialized Automerge change to a document. */
export const nativeApplyChange = async (docId: string, changeBytes: number[]): Promise<boolean> => {
    const result = await invokeCommand('collab_apply_change', { docId, changeBytes });
    return Boolean(result);
};

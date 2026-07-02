import { invokeCommand } from './invokeCommand';

/** Apply a serialized Automerge change to a document. */
export async function nativeApplyChange(docId: string, changeBytes: number[]): Promise<boolean> {
    const result = await invokeCommand('collab_apply_change', { docId, changeBytes });
    return Boolean(result);
}

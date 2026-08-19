import { invokeCommand } from './invokeCommand';

/** Apply a serialized Automerge change to a document. */
export async function nativeApplyChange(docId: string, changeBytes: Uint8Array): Promise<boolean> {
    // The addon takes a Buffer, so the desktop bridge carries the trailing
    // byte payload through its binary channel. Off-desktop, `invokeCommand`
    // returns null before anything crosses a wire.
    const result = await invokeCommand('collab_apply_change', { docId, changeBytes });
    return Boolean(result);
}

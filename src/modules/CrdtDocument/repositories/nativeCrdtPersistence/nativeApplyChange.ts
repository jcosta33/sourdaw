import { isSourdawRuntime } from '#/utils/tauriRuntime';

import { invokeCommand } from './invokeCommand';

/** Apply a serialized Automerge change to a document. */
export async function nativeApplyChange(docId: string, changeBytes: Uint8Array): Promise<boolean> {
    // The Electron bridge routes a trailing byte payload through its binary
    // channel (the addon takes a Buffer); Tauri's JSON wire needs a plain array.
    const wireBytes = isSourdawRuntime() ? changeBytes : Array.from(changeBytes);
    const result = await invokeCommand('collab_apply_change', { docId, changeBytes: wireBytes });
    return Boolean(result);
}

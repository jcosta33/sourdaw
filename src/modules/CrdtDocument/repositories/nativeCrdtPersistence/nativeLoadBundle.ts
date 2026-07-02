import { type DocumentBundle } from '../../models/CrdtDocumentTypes';

import { invokeCommand } from './invokeCommand';

/** Load CRDT documents from a native .sdaw file. */
export async function nativeLoadBundle(path: string): Promise<DocumentBundle | null> {
    const result = await invokeCommand('collab_load_bundle', { path });
    if (!result || typeof result !== 'object') {
        return null;
    }

    const bundle: DocumentBundle = new Map();
    for (const [id, bytes] of Object.entries(result as Record<string, number[]>)) {
        bundle.set(id, new Uint8Array(bytes));
    }
    return bundle;
}

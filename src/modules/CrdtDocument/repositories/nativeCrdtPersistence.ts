import { type DocumentBundle } from '../models/CrdtDocumentTypes';

const isTauriAvailable = (): boolean => {
    return typeof window !== 'undefined' && '__TAURI__' in window;
};

const invokeCommand = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (!isTauriAvailable()) {
        return null;
    }

    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
};

/** Create a new CRDT project via the native backend. */
export const nativeCreateProject = async (name: string, sampleRate: number): Promise<boolean> => {
    const result = await invokeCommand('collab_create_project', { name, sampleRate });
    return Boolean(result);
};

/** Save all CRDT documents to a native .sdaw file. */
export const nativeSaveBundle = async (path: string): Promise<boolean> => {
    const result = await invokeCommand('collab_save_bundle', { path });
    return Boolean(result);
};

/** Load CRDT documents from a native .sdaw file. */
export const nativeLoadBundle = async (path: string): Promise<DocumentBundle | null> => {
    const result = await invokeCommand('collab_load_bundle', { path });
    if (!result || typeof result !== 'object') {
        return null;
    }

    const bundle: DocumentBundle = new Map();
    for (const [id, bytes] of Object.entries(result as Record<string, number[]>)) {
        bundle.set(id, new Uint8Array(bytes));
    }
    return bundle;
};

/** Get a JSON snapshot of a document from the native backend. */
export const nativeGetDocumentState = async (docId: string): Promise<unknown> => {
    return invokeCommand('collab_get_document_state', { docId });
};

/** Merge an external .sdaw bundle into the current project. */
export const nativeMergeBundle = async (
    path: string
): Promise<{ mergedDocIds: string[]; newDocIds: string[] } | null> => {
    const result = await invokeCommand('collab_merge_bundle', { path });
    if (!result || typeof result !== 'object') {
        return null;
    }
    return result as { mergedDocIds: string[]; newDocIds: string[] };
};

/** Apply a serialized Automerge change to a document. */
export const nativeApplyChange = async (docId: string, changeBytes: number[]): Promise<boolean> => {
    const result = await invokeCommand('collab_apply_change', { docId, changeBytes });
    return Boolean(result);
};

/** Check whether the native CRDT backend is available. */
export const isNativeCrdtAvailable = (): boolean => {
    return isTauriAvailable();
};

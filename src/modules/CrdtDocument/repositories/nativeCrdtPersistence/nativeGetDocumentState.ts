import { invokeCommand } from './helpers';

/** Get a JSON snapshot of a document from the native backend. */
export const nativeGetDocumentState = async (docId: string): Promise<unknown> => {
    return invokeCommand('collab_get_document_state', { docId });
};

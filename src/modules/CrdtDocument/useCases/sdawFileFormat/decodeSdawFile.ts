import { createSdawFormatError } from '../../errors/SdawFormatError';
import { type DocumentBundle } from '../../models/CrdtDocumentTypes';

import { FORMAT_VERSION, SDAW_MAGIC } from './helpers';

/**
 * Decode an .sdaw binary into a document bundle.
 */
export function decodeSdawFile(bytes: Uint8Array): DocumentBundle {
    const decoder = new TextDecoder();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;

    // Verify magic
    if (bytes.length < 8) {
        throw createSdawFormatError('Invalid .sdaw file: too short');
    }

    for (let index = 0; index < 4; index++) {
        if (bytes[offset + index] !== SDAW_MAGIC[index]) {
            throw createSdawFormatError('Invalid .sdaw file: bad magic bytes');
        }
    }
    offset += 4;

    // Read version
    const version = view.getUint16(offset, true);
    offset += 2;
    if (version !== FORMAT_VERSION) {
        throw createSdawFormatError(`Unsupported .sdaw version: ${version} (expected ${FORMAT_VERSION})`);
    }

    // Read document count
    const docCount = view.getUint16(offset, true);
    offset += 2;

    const bundle: DocumentBundle = new Map();

    for (let index = 0; index < docCount; index++) {
        // Read DocId
        if (offset + 4 > bytes.length) {
            throw createSdawFormatError(`Truncated at document ${index} DocId length`);
        }
        const idLen = view.getUint32(offset, true);
        offset += 4;

        if (offset + idLen > bytes.length) {
            throw createSdawFormatError(`Truncated at document ${index} DocId`);
        }
        const docId = decoder.decode(bytes.subarray(offset, offset + idLen));
        offset += idLen;

        // Read data
        if (offset + 4 > bytes.length) {
            throw createSdawFormatError(`Truncated at document ${index} data length`);
        }
        const dataLen = view.getUint32(offset, true);
        offset += 4;

        if (offset + dataLen > bytes.length) {
            throw createSdawFormatError(`Truncated at document ${index} data`);
        }
        const data = bytes.slice(offset, offset + dataLen);
        offset += dataLen;

        bundle.set(docId, data);
    }

    return bundle;
}

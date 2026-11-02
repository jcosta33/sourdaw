import { extractGuardedZip } from '#/infra/archive/extractGuardedZip';

import {
    METADATA_XML_ENTRY_NAME,
    METADATA_XML_ENTRY_PATH,
    PROJECT_XML_ENTRY_NAME,
    PROJECT_XML_ENTRY_PATH,
} from '../models/DawProjectEntryNames';

import type { DawProjectZipWorkerRequest } from '../models/DawProjectZipWorkerProtocol';

const audioAssetPath = /^audio\//;

/**
 * Pure extraction logic shared by the worker entry point and its tests.
 * Runs entirely off the caller's thread: the streaming inflate/CRC loop in
 * `extractGuardedZip` never touches the caller's call stack.
 */
export function runDawProjectZipWorkerRequest(
    request: DawProjectZipWorkerRequest
): Record<string, Uint8Array<ArrayBuffer>> {
    const bytes = new Uint8Array(request.bytes);
    const extracted =
        request.phase === 'header'
            ? extractGuardedZip({
                  bytes,
                  include: (path) => PROJECT_XML_ENTRY_PATH.test(path) || METADATA_XML_ENTRY_PATH.test(path),
                  validateInventory: validateDawProjectRootInventory,
                  restrictLimits: request.restrictLimits,
              })
            : extractGuardedZip({
                  bytes,
                  include: (path) => audioAssetPath.test(path),
                  restrictLimits: request.restrictLimits,
              });
    return toTransferableEntries(extracted);
}

function toTransferableEntries(entries: Record<string, Uint8Array>): Record<string, Uint8Array<ArrayBuffer>> {
    const transferable: Record<string, Uint8Array<ArrayBuffer>> = {};
    for (const [path, data] of Object.entries(entries)) {
        if (path.endsWith('/')) {
            continue;
        }
        const buffer = data.buffer;
        if (!(buffer instanceof ArrayBuffer) || data.byteOffset !== 0 || data.byteLength !== buffer.byteLength) {
            throw new Error(`Archive extraction produced a non-transferable view for ${path}`);
        }
        transferable[path] = new Uint8Array(buffer);
    }
    return transferable;
}

function validateDawProjectRootInventory(paths: readonly string[]): void {
    const projectRoots = paths.filter((path) => PROJECT_XML_ENTRY_PATH.test(path));
    if (projectRoots.length === 0) {
        throw new Error(`DAWproject archive is missing ${PROJECT_XML_ENTRY_NAME} at its root`);
    }
    if (projectRoots.length > 1) {
        throw new Error(`DAWproject archive contains duplicate ${PROJECT_XML_ENTRY_NAME} roots`);
    }
    const metadataRoots = paths.filter((path) => METADATA_XML_ENTRY_PATH.test(path));
    if (metadataRoots.length > 1) {
        throw new Error(`DAWproject archive contains duplicate ${METADATA_XML_ENTRY_NAME} roots`);
    }
}

import { type ZipExtractionLimits } from '#/infra/archive/extractGuardedZip';

import { runDawProjectZipWorkerRequest } from '../workers/runDawProjectZipWorkerRequest';

import type { DawProjectZipWorkerPhase } from '../models/DawProjectZipWorkerProtocol';

type ExtractInput = {
    bytes: Uint8Array;
    phase: DawProjectZipWorkerPhase;
    restrictLimits?: Partial<ZipExtractionLimits>;
};

/**
 * Stands in for `extractDawProjectZipEntries` where no real Worker exists: only the Worker
 * transport is replaced, and the extraction core the worker entry runs stays the real one.
 */
export function extractDawProjectZipEntriesInProcess(input: ExtractInput) {
    return Promise.resolve({
        entries: runDawProjectZipWorkerRequest({
            bytes: input.bytes.slice().buffer,
            phase: input.phase,
            restrictLimits: input.restrictLimits,
        }),
    });
}

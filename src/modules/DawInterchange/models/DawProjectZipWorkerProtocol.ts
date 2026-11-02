import { type ZipExtractionLimits } from '#/infra/archive/extractGuardedZip';

export type DawProjectZipWorkerPhase = 'header' | 'audio';

export type DawProjectZipWorkerRequest = {
    bytes: ArrayBuffer;
    phase: DawProjectZipWorkerPhase;
    restrictLimits?: Partial<ZipExtractionLimits>;
};

export type DawProjectZipWorkerResponse =
    { type: 'success'; entries: Record<string, ArrayBuffer> } | { type: 'error'; message: string };

import { extractGuardedZip } from './extractGuardedZip';

export type GuardedZipWorkerRequest = {
    bytes: ArrayBuffer;
    suffix: string;
};

export type GuardedZipWorkerResponse =
    | { type: 'success'; path: string; data: ArrayBuffer }
    | {
          type: 'error';
          code: 'invalid-archive';
          message: string;
      };

type RunGuardedZipWorkerRequestOutput = {
    path: string;
    data: Uint8Array<ArrayBuffer>;
};

export function runGuardedZipWorkerRequest(request: GuardedZipWorkerRequest): RunGuardedZipWorkerRequestOutput {
    let selectedPath: string | undefined;
    const extracted = extractGuardedZip({
        bytes: new Uint8Array(request.bytes),
        validateInventory: (paths) => {
            const matches = paths.filter((path) => path.endsWith(request.suffix));
            if (matches.length === 0) {
                throw new Error(`Archive contains no ${request.suffix} entry`);
            }
            if (matches.length > 1) {
                throw new Error(`Archive contains multiple ${request.suffix} entries`);
            }
            selectedPath = matches[0];
        },
        include: (path) => path === selectedPath,
    });
    if (!selectedPath) {
        throw new Error(`Archive contains no ${request.suffix} entry`);
    }
    const data = extracted[selectedPath];
    if (!data) {
        throw new Error(`Archive extraction did not produce ${selectedPath}`);
    }
    const buffer = data.buffer;
    if (!(buffer instanceof ArrayBuffer) || data.byteOffset !== 0 || data.byteLength !== buffer.byteLength) {
        throw new Error(`Archive extraction produced a non-transferable view for ${selectedPath}`);
    }
    return { path: selectedPath, data: new Uint8Array(buffer) };
}

import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import {
    type ProjectCommandBatchIdempotencyRecord,
    type ProjectCommandBatchIdempotencyState,
} from '../models/CommandBatchIdempotency';

const DOC_PREFIX_ROOT = 'root';
const MAX_RECORDS = 4_096;
const MAX_RECEIPT_BYTES = 1_048_576;

export const defaultProjectCommandBatchIdempotencyState: ProjectCommandBatchIdempotencyState = { records: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidRecord(value: unknown): value is ProjectCommandBatchIdempotencyRecord {
    if (!isRecord(value)) {
        return false;
    }
    const keys = ['id', 'projectId', 'idempotencyKey', 'contentHash', 'serializedReceipt'];
    if (Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
        return false;
    }
    if (
        typeof value.id !== 'string' ||
        typeof value.projectId !== 'string' ||
        typeof value.idempotencyKey !== 'string' ||
        typeof value.contentHash !== 'string' ||
        typeof value.serializedReceipt !== 'string'
    ) {
        return false;
    }
    return (
        value.id.length > 0 &&
        value.projectId.length > 0 &&
        value.projectId.length <= 512 &&
        value.idempotencyKey.length > 0 &&
        value.idempotencyKey.length <= 1_024 &&
        /^sha256:[a-f0-9]{64}$/.test(value.contentHash) &&
        value.id === `${value.projectId}\u0000${value.idempotencyKey}\u0000${value.contentHash}` &&
        value.serializedReceipt.length > 0 &&
        new TextEncoder().encode(value.serializedReceipt).byteLength <= MAX_RECEIPT_BYTES
    );
}

function isExactState(value: unknown): value is ProjectCommandBatchIdempotencyState {
    if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.records)) {
        return false;
    }
    return value.records.length <= MAX_RECORDS && value.records.every(isValidRecord);
}

export function sanitizeProjectCommandBatchIdempotencyState(value: unknown): ProjectCommandBatchIdempotencyState {
    return isExactState(value) ? value : defaultProjectCommandBatchIdempotencyState;
}

export const commandBatchIdempotencyStore = createStore<ProjectCommandBatchIdempotencyState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'commandBatchIdempotency', {
        crdtEntityIdentity: {
            records: (value) => (isValidRecord(value) ? value.id : null),
        },
        hydrateMissing: () => defaultProjectCommandBatchIdempotencyState,
    }),
    initialData: defaultProjectCommandBatchIdempotencyState,
    sanitize: sanitizeProjectCommandBatchIdempotencyState,
});

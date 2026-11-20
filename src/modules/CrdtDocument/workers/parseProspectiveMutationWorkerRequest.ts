import {
    BOUNDED_NATIVE_SEQUENCE_POLICY,
    type ProspectiveMutationWorkerRequest,
} from '../models/ProspectiveMutationWorkerProtocol';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJson(value: unknown): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return Array.from(value).every(isJson);
    }
    return (
        isRecord(value) &&
        Object.getPrototypeOf(value) === Object.prototype &&
        Reflect.ownKeys(value).every(
            (key) =>
                typeof key === 'string' &&
                Object.prototype.propertyIsEnumerable.call(value, key) &&
                isJson(Reflect.get(value, key))
        )
    );
}

function hasValidOptionalMetadata(
    value: Record<string, unknown>
): value is Record<string, unknown> & { message?: string; time?: number } {
    return (
        (value.message === undefined || typeof value.message === 'string') &&
        (value.time === undefined || (typeof value.time === 'number' && Number.isFinite(value.time)))
    );
}

type ProspectiveMutationEnvelope = Omit<ProspectiveMutationWorkerRequest, 'mutation'> & Record<string, unknown>;

function assertProspectiveMutationEnvelope(value: unknown): asserts value is ProspectiveMutationEnvelope {
    if (
        !isRecord(value) ||
        !(value.seed instanceof Uint8Array) ||
        !(value.seed.buffer instanceof ArrayBuffer) ||
        !Array.isArray(value.heads) ||
        !value.heads.every(
            (head: unknown): head is string => typeof head === 'string' && /^[a-f0-9]{64}$/.test(head)
        ) ||
        typeof value.actor !== 'string' ||
        !/^(?:[a-f0-9]{2})+$/.test(value.actor) ||
        !hasValidOptionalMetadata(value) ||
        (value.preparationPolicy !== undefined && value.preparationPolicy !== BOUNDED_NATIVE_SEQUENCE_POLICY)
    ) {
        throw new TypeError('Invalid prospective mutation Worker envelope');
    }
}

export function parseProspectiveMutationWorkerRequest(value: unknown): ProspectiveMutationWorkerRequest {
    assertProspectiveMutationEnvelope(value);
    const mutation = value.mutation;
    if (
        !isRecord(mutation) ||
        mutation.kind !== 'canonical-json-slot-v1' ||
        typeof mutation.key !== 'string' ||
        !isJson(mutation.baseValue) ||
        !isJson(mutation.value) ||
        (mutation.documentPresence !== undefined &&
            (!isRecord(mutation.documentPresence) ||
                (mutation.documentPresence.slot !== undefined && !isJson(mutation.documentPresence.slot))))
    ) {
        throw new TypeError('Invalid canonical storage slot description');
    }
    const documentPresence = mutation.documentPresence;
    const parsed: ProspectiveMutationWorkerRequest = {
        seed: new Uint8Array(value.seed.buffer, value.seed.byteOffset, value.seed.byteLength),
        heads: value.heads,
        actor: value.actor,
        message: value.message,
        time: value.time,
        mutation: {
            kind: mutation.kind,
            key: mutation.key,
            baseValue: mutation.baseValue,
            value: mutation.value,
            documentPresence: documentPresence === undefined ? undefined : { slot: documentPresence.slot },
        },
    };
    if (value.preparationPolicy === BOUNDED_NATIVE_SEQUENCE_POLICY) {
        return { ...parsed, preparationPolicy: value.preparationPolicy };
    }
    return parsed;
}

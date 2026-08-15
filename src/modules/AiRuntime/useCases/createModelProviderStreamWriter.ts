import {
    MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
    type ModelProviderEvent,
    type ModelProviderFinish,
    type ModelProviderRequest,
    type ModelProviderResult,
    type ModelProviderSession,
} from '../models/ModelProviderProtocol';

export function createModelProviderStreamWriter(
    request: ModelProviderRequest,
    session: ModelProviderSession
): {
    push: (event: ModelProviderEvent) => void;
    finish: (finish: ModelProviderFinish) => ModelProviderResult;
} {
    let sequence = 0;
    let finished = false;
    const identity = {
        schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
        runId: request.runId,
        requestId: request.requestId,
        correlationId: request.correlationId,
        cancellationGeneration: request.cancellationGeneration,
    } as const;
    return {
        push(event) {
            if (finished) {
                throw new TypeError('Provider stream already emitted its terminal outcome.');
            }
            session.push({ ...identity, sequence, event: structuredClone(event) });
            sequence += 1;
        },
        finish(finish) {
            if (finished) {
                throw new TypeError('Provider stream already emitted its terminal outcome.');
            }
            const result = session.finish({ ...identity, sequence, finish: structuredClone(finish) });
            sequence += 1;
            finished = true;
            return result;
        },
    };
}

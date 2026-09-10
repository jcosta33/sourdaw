import { type AgentDataCategory, type RemoteTransmissionDisclosure } from '../../models/AgentDataPolicy';
import {
    MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
    type ModelProviderBudget,
    type ModelProviderEvent,
    type ModelProviderFinish,
    type ModelProviderModality,
    type ModelProviderName,
    type ModelProviderOperation,
    type ModelProviderRequest,
    type ModelProviderTool,
} from '../../models/ModelProviderProtocol';
import { createModelProviderProtocol } from '../modelProviderProtocol';

export type CreateRequestOptions = {
    provider?: ModelProviderName;
    modality?: ModelProviderModality;
    operation?: ModelProviderOperation;
    tools?: ModelProviderTool[];
    allowParallelToolCalls?: boolean;
    budget?: ModelProviderBudget;
    limits?: { maxOutputTokens: number };
    dataPolicy?: 'local-only' | 'remote-allowed';
    dataCategories?: AgentDataCategory[];
    remoteDisclosure?: RemoteTransmissionDisclosure;
    correlationId?: string;
    requestId?: string;
    cancellationGeneration?: number;
};

export function createRequest(options: CreateRequestOptions = {}) {
    const provider = options.provider ?? 'webllm';
    const protocol = createModelProviderProtocol({ provider, model: 'fixture-model' });
    const compiled = protocol.compileRequest({
        correlationId: options.correlationId ?? 'correlation-1',
        runId: 'run-1',
        requestId: options.requestId ?? 'request-1',
        cancellationGeneration: options.cancellationGeneration ?? 0,
        operation: options.operation ?? 'text',
        modality: options.modality ?? 'text',
        messages: [{ role: 'user', content: 'Set the tempo.' }],
        ...(options.tools === undefined ? {} : { tools: options.tools }),
        ...(options.allowParallelToolCalls === undefined
            ? {}
            : { allowParallelToolCalls: options.allowParallelToolCalls }),
        stream: true,
        limits: options.limits ?? { maxOutputTokens: 256 },
        controls: { cache: 'provider-default', reasoning: 'provider-default' },
        budget: options.budget ?? { maxInputTokens: 1_024, maxOutputTokens: 256, maxTotalTokens: 1_280 },
        dataPolicy: options.dataPolicy ?? 'local-only',
        ...(options.dataCategories === undefined ? {} : { dataCategories: options.dataCategories }),
        ...(options.remoteDisclosure === undefined ? {} : { remoteDisclosure: options.remoteDisclosure }),
    });
    return { protocol, compiled };
}

export function readyRequest(options: CreateRequestOptions = {}) {
    const { protocol, compiled } = createRequest(options);
    if (compiled.status !== 'ready') {
        throw new Error(compiled.failure.safeMessage);
    }
    return { protocol, request: compiled.request };
}

export type RequestIdentity = Pick<
    ModelProviderRequest,
    'runId' | 'requestId' | 'correlationId' | 'cancellationGeneration'
>;

export function eventEnvelope(request: RequestIdentity, sequence: number, event: ModelProviderEvent) {
    return {
        schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
        runId: request.runId,
        requestId: request.requestId,
        correlationId: request.correlationId,
        cancellationGeneration: request.cancellationGeneration,
        sequence,
        event,
    };
}

export function finishEnvelope(request: RequestIdentity, sequence: number, finish: ModelProviderFinish) {
    return {
        schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
        runId: request.runId,
        requestId: request.requestId,
        correlationId: request.correlationId,
        cancellationGeneration: request.cancellationGeneration,
        sequence,
        finish,
    };
}

export const MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION = 2 as const;

export const MODEL_PROVIDER_NAMES = ['native', 'webllm', 'anthropic', 'openai', 'openai-compatible'] as const;
export const MODEL_PROVIDER_OPERATIONS = ['text', 'tools', 'structured-output'] as const;

export type ModelProviderName = (typeof MODEL_PROVIDER_NAMES)[number];
export type ModelProviderOperation = (typeof MODEL_PROVIDER_OPERATIONS)[number];
export type ModelProviderModality = 'text' | 'audio' | 'image' | 'video';
export type ModelProviderUsageProvenance = 'provider-reported' | 'versioned-estimate' | 'unavailable';
export type ModelProviderPartialOutputDisposition = 'none' | 'preserve' | 'discard';

export type ModelProviderCapabilities = {
    text: boolean;
    tools: boolean;
    structuredOutput: boolean;
    parallelToolCalls: boolean;
    streaming: boolean;
    contextWindowTokens: number | null;
    maxOutputTokens: number | null;
    cacheControls: readonly ('provider-default' | 'allow' | 'bypass')[];
    reasoningControls: readonly ('provider-default' | 'enabled' | 'disabled')[];
    dataPolicies: readonly ('local-only' | 'remote-allowed')[];
    media: Record<Exclude<ModelProviderModality, 'text'>, 'available' | 'unavailable'>;
};

export type ModelProviderMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
};

export type ModelProviderTool = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
};

export type ModelProviderBudget = {
    maxInputTokens: number;
    maxOutputTokens: number;
    maxTotalTokens: number;
};

export type ModelProviderStreamIdentity = {
    runId: string;
    requestId: string;
    correlationId: string;
    cancellationGeneration: number;
};

export type ModelProviderRequestInput = Partial<Omit<ModelProviderStreamIdentity, 'correlationId'>> & {
    correlationId: string;
    operation: ModelProviderOperation;
    modality: ModelProviderModality;
    messages: ModelProviderMessage[];
    tools?: ModelProviderTool[];
    responseSchema?: Record<string, unknown>;
    allowParallelToolCalls?: boolean;
    stream: boolean;
    limits: {
        maxContextTokens?: number;
        maxOutputTokens: number;
    };
    controls: {
        cache: 'provider-default' | 'allow' | 'bypass';
        reasoning: 'provider-default' | 'enabled' | 'disabled';
    };
    budget: ModelProviderBudget;
    dataPolicy: 'local-only' | 'remote-allowed';
    dataCategories?: AgentDataCategory[];
    remoteDisclosure?: RemoteTransmissionDisclosure;
};

export type ModelProviderRequest = Omit<ModelProviderRequestInput, keyof ModelProviderStreamIdentity> &
    ModelProviderStreamIdentity & {
        schemaVersion: typeof MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION;
    };

export type ModelProviderUsage = {
    inputTokens: number | null;
    outputTokens: number | null;
    cachedInputTokens: number | null;
    reasoningTokens: number | null;
    provenance: ModelProviderUsageProvenance;
};

export type ModelProviderFailure = {
    code: string;
    correlationId: string;
    retryable: boolean;
    safeMessage: string;
    partialOutputDisposition: ModelProviderPartialOutputDisposition;
};

export type ModelProviderToolCall = {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
};

export type ModelProviderEvent =
    | { type: 'text'; mode: 'delta' | 'cumulative-snapshot'; text: string }
    | { type: 'reasoning'; mode: 'delta' | 'cumulative-snapshot'; text: string }
    | { type: 'tool-call'; call: ModelProviderToolCall }
    | { type: 'structured-output'; value: unknown }
    | {
          type: 'usage';
          mode: 'delta' | 'cumulative-snapshot' | 'final';
          usage: Omit<ModelProviderUsage, 'provenance'>;
          provenance: ModelProviderUsageProvenance;
      }
    | { type: 'unknown'; providerEventType: string };

export type ModelProviderFinish =
    | { reason: 'stop' }
    | { reason: 'length' }
    | { reason: 'cancelled' }
    | {
          reason: 'error' | 'refusal';
          failure: Pick<ModelProviderFailure, 'code' | 'retryable' | 'safeMessage'>;
      };

export type ModelProviderEventEnvelope = ModelProviderStreamIdentity & {
    schemaVersion: typeof MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION;
    sequence: number;
    event: ModelProviderEvent;
};

export type ModelProviderFinishEnvelope = ModelProviderStreamIdentity & {
    schemaVersion: typeof MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION;
    sequence: number;
    finish: ModelProviderFinish;
};

export type ModelProviderResult = {
    schemaVersion: typeof MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION;
    provider: ModelProviderName;
    model: string | null;
    correlationId: string;
    status: 'complete' | 'partial' | 'failed' | 'cancelled' | 'unavailable';
    output: {
        text: string;
        reasoning: string;
        toolCalls: ModelProviderToolCall[];
        structuredOutput: unknown;
    };
    usage: ModelProviderUsage;
    finishReason: ModelProviderFinish['reason'] | 'unavailable';
    partialOutputDisposition: ModelProviderPartialOutputDisposition;
    failure: ModelProviderFailure | null;
    ignoredProviderEvents: string[];
};

export type CompiledModelProviderRequest =
    { status: 'ready'; request: ModelProviderRequest } | { status: 'unavailable'; failure: ModelProviderFailure };

export type ModelProviderSession = {
    push: (envelope: ModelProviderEventEnvelope) => void;
    finish: (envelope: ModelProviderFinishEnvelope) => ModelProviderResult;
};

export type ModelProviderProtocol = {
    capabilities: ModelProviderCapabilities;
    compileRequest: (input: ModelProviderRequestInput) => CompiledModelProviderRequest;
    start: (request: ModelProviderRequest) => ModelProviderSession;
};
import { type AgentDataCategory, type RemoteTransmissionDisclosure } from './AgentDataPolicy';

import { readClipTransientOnsets } from '#/modules/ElasticAudio/useCases';
import { getSettledProjectId } from '#/modules/Project/stores';
import { digest } from '#/utils/canonicalDigest';

import { ANALYSIS_DETECT_TRANSIENTS_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type MeasurementAdmitter } from '../models/MeasurementBudget';
import { type ToolCallResult } from '../models/ToolCallResult';
import { readAgentResourceLimits } from '../stores/agentResourceLimitsStore';

type Source = Extract<Awaited<ReturnType<typeof readClipTransientOnsets>>, { status: 'complete' }>;
type Entry = { source: Source; sensitivity: number };
type Call = { call: ToolCallResult; callId: string; turn: number };
type ParsedArguments = { clipId: string; sensitivity: number; cursor?: string };

const PAGE_SIZE = 64;
const MAX_RECEIPT_BYTES = 16_384;
const MAX_SOURCE_SECONDS = 600;
const MAX_CHANNEL_SAMPLES = 10_000_000;
const MAX_ANALYSIS_MS = 120_000;

function parseArguments(value: unknown): ParsedArguments | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    const argumentsValue = value as Record<string, unknown>;
    if (
        Object.keys(argumentsValue).some((key) => key !== 'clipId' && key !== 'sensitivity' && key !== 'cursor') ||
        typeof argumentsValue.clipId !== 'string' ||
        argumentsValue.clipId.length === 0 ||
        argumentsValue.clipId.length > 256 ||
        (argumentsValue.sensitivity !== undefined &&
            (typeof argumentsValue.sensitivity !== 'number' ||
                !Number.isFinite(argumentsValue.sensitivity) ||
                argumentsValue.sensitivity < 0 ||
                argumentsValue.sensitivity > 1)) ||
        (argumentsValue.cursor !== undefined &&
            (typeof argumentsValue.cursor !== 'string' ||
                argumentsValue.cursor.length === 0 ||
                argumentsValue.cursor.length > 128))
    ) {
        return null;
    }
    return {
        clipId: argumentsValue.clipId,
        sensitivity: typeof argumentsValue.sensitivity === 'number' ? argumentsValue.sensitivity : 0.5,
        ...(typeof argumentsValue.cursor === 'string' ? { cursor: argumentsValue.cursor } : {}),
    };
}

function failure(call: Call, code: string): ApplicationToolReceipt {
    const safeMessage = `Transient source read refused: ${code}.`;
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: call.callId,
        toolName: ANALYSIS_DETECT_TRANSIENTS_TOOL_NAME,
        turn: call.turn,
        status: 'failure',
        revision: null,
        data: null,
        summary: safeMessage,
        warnings: [],
        error: { code, safeMessage, retryable: code === 'stale-source' || code === 'analysis-timed-out' },
    };
}

function cacheKey(clipId: string, sensitivity: number): string {
    return JSON.stringify([clipId, sensitivity]);
}

/** A run-local, disposable read session. Its caller must dispose it when planning ends. */
export function executeTransientOnsetRead(input: {
    projectRevision: string;
    signal?: AbortSignal;
    admit?: MeasurementAdmitter;
}): { execute: (call: Call) => Promise<ApplicationToolReceipt>; dispose: () => void } {
    const projectId = getSettledProjectId();
    const sourceRevisionDigest = digest(input.projectRevision);
    const sessionNonce = crypto.randomUUID();
    const entries = new Map<string, Entry>();
    const cursors = new Map<string, { entry: Entry; offset: number }>();
    const pending = new Set<string>();
    const controller = new AbortController();
    let disposed = false;

    const dispose = (): void => {
        if (disposed) {
            return;
        }
        disposed = true;
        controller.abort();
        entries.clear();
        cursors.clear();
        pending.clear();
        input.signal?.removeEventListener('abort', dispose);
    };
    input.signal?.addEventListener('abort', dispose, { once: true });
    if (input.signal?.aborted) {
        dispose();
    }

    const execute = async (call: Call): Promise<ApplicationToolReceipt> => {
        if (call.call.name !== ANALYSIS_DETECT_TRANSIENTS_TOOL_NAME) {
            return failure(call, 'invalid-tool-name');
        }
        const parsed = parseArguments(call.call.arguments);
        if (parsed === null) {
            return failure(call, 'invalid-tool-arguments');
        }
        if (disposed || controller.signal.aborted) {
            return failure(call, 'cancelled');
        }
        if (!projectId || input.projectRevision.length === 0) {
            return failure(call, 'stale-source');
        }

        const requestedPage = parsed.cursor === undefined ? undefined : cursors.get(parsed.cursor);
        if (
            parsed.cursor !== undefined &&
            (requestedPage === undefined ||
                requestedPage.entry.source.identity.clipId !== parsed.clipId ||
                requestedPage.entry.sensitivity !== parsed.sensitivity)
        ) {
            return failure(call, 'invalid-cursor');
        }

        const key = cacheKey(parsed.clipId, parsed.sensitivity);
        let entry = requestedPage?.entry ?? entries.get(key);
        if (entry === undefined) {
            if (pending.has(key)) {
                return failure(call, 'analysis-in-progress');
            }
            const admission = input.admit?.({ renderJobs: 0, analyses: 1 });
            if (admission === undefined || admission.status === 'refused') {
                return failure(call, 'measurement-budget-exhausted');
            }
            pending.add(key);
            let analyses = 0;
            try {
                const limits = readAgentResourceLimits();
                const source = await readClipTransientOnsets({
                    clipId: parsed.clipId,
                    sensitivity: parsed.sensitivity,
                    projectId,
                    projectRevision: input.projectRevision,
                    maxSourceSeconds: Math.min(limits.measurementMeasuredSeconds, MAX_SOURCE_SECONDS),
                    maxChannelSamples: MAX_CHANNEL_SAMPLES,
                    timeoutMs: Math.min(limits.measurementWallClockMs, MAX_ANALYSIS_MS),
                    signal: controller.signal,
                    onAnalysisStarted: () => {
                        analyses = 1;
                    },
                });
                if (disposed || controller.signal.aborted) {
                    return failure(call, 'cancelled');
                }
                if (source.status === 'failed') {
                    if (source.code === 'stale-source') {
                        dispose();
                    }
                    return failure(call, source.code);
                }
                if (source.identity.clipId !== parsed.clipId || source.identity.projectId !== projectId) {
                    dispose();
                    return failure(call, 'stale-source');
                }
                entry = { source, sensitivity: parsed.sensitivity };
                entries.set(key, entry);
            } catch {
                return failure(call, disposed ? 'cancelled' : 'analysis-failed');
            } finally {
                pending.delete(key);
                admission.settle({ renderJobs: 0, analyses });
            }
        }

        let current: boolean;
        try {
            current = entry.source.isCurrent();
        } catch {
            current = false;
        }
        if (!current || disposed) {
            dispose();
            return failure(call, 'stale-source');
        }

        const { source } = entry;
        const offset = requestedPage?.offset ?? 0;
        const hits = source.hits.slice(offset, offset + PAGE_SIZE).map((hit) => ({
            sourceSeconds: hit.sampleOffset / source.identity.sampleRate,
            confidence: hit.confidence,
        }));
        const nextOffset = offset + hits.length;
        const nextCursor = nextOffset < source.hits.length ? `${sessionNonce}.${crypto.randomUUID()}` : null;
        const receipt: ApplicationToolReceipt = {
            schema: 'sourdaw.application-tool-receipt',
            schemaVersion: 1,
            callId: call.callId,
            toolName: ANALYSIS_DETECT_TRANSIENTS_TOOL_NAME,
            turn: call.turn,
            status: 'success',
            revision: sourceRevisionDigest,
            data: {
                kind: 'transient-onset-read',
                schemaVersion: 1,
                ...source.identity,
                sourceRevisionDigest,
                timeAxis: 'source-buffer',
                sensitivity: entry.sensitivity,
                totalHitCount: source.hits.length,
                coverage: { startFrame: 0, endFrame: source.identity.frameCount, offset, endOffset: nextOffset },
                hits,
                nextCursor,
                complete: nextCursor === null,
            },
            summary: `Read ${String(hits.length)} source-buffer onsets; ${String(source.hits.length)} total.`,
            warnings: [],
            error: null,
        };
        if (new TextEncoder().encode(JSON.stringify(receipt)).byteLength > MAX_RECEIPT_BYTES) {
            return failure(call, 'tool-receipt-too-large');
        }
        if (parsed.cursor !== undefined) {
            cursors.delete(parsed.cursor);
        }
        if (nextCursor !== null) {
            cursors.set(nextCursor, { entry, offset: nextOffset });
        }
        return receipt;
    };

    return { execute, dispose };
}

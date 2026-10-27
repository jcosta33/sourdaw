import { projectRevisionMatchesLiveIgnoringCommandCheckpoint } from '#/modules/CrdtDocument/useCases';
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
    const parsed: ParsedArguments = {
        clipId: argumentsValue.clipId,
        sensitivity: typeof argumentsValue.sensitivity === 'number' ? argumentsValue.sensitivity : 0.5,
    };
    if (typeof argumentsValue.cursor === 'string') {
        parsed.cursor = argumentsValue.cursor;
    }
    return parsed;
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

type ReadInput = {
    projectRevision: string;
    signal?: AbortSignal;
    admit?: MeasurementAdmitter;
};
type Page = { entry: Entry; offset: number };
type Session = {
    input: ReadInput;
    projectId: ReturnType<typeof getSettledProjectId>;
    sourceRevisionDigest: string;
    nonce: string;
    entries: Map<string, Entry>;
    cursors: Map<string, Page>;
    pending: Set<string>;
    controller: AbortController;
    disposed: boolean;
};
type EntryResult = { status: 'ready'; entry: Entry } | { status: 'failed'; receipt: ApplicationToolReceipt };

async function readEntry(input: {
    session: Session;
    call: Call;
    parsed: ParsedArguments;
    projectId: string;
    dispose: () => void;
}): Promise<EntryResult> {
    const { session, call, parsed, projectId, dispose } = input;
    const key = cacheKey(parsed.clipId, parsed.sensitivity);
    const refuse = (code: string): EntryResult => ({ status: 'failed', receipt: failure(call, code) });
    if (session.pending.has(key)) {
        return refuse('analysis-in-progress');
    }
    const admission = session.input.admit?.({ renderJobs: 0, analyses: 1 });
    if (admission === undefined || admission.status === 'refused') {
        return refuse('measurement-budget-exhausted');
    }
    session.pending.add(key);
    let analyses = 0;
    try {
        const limits = readAgentResourceLimits();
        const source = await readClipTransientOnsets({
            clipId: parsed.clipId,
            sensitivity: parsed.sensitivity,
            projectId,
            isProjectRevisionCurrent: () =>
                projectRevisionMatchesLiveIgnoringCommandCheckpoint(session.input.projectRevision),
            maxSourceSeconds: Math.min(limits.measurementMeasuredSeconds, MAX_SOURCE_SECONDS),
            maxChannelSamples: MAX_CHANNEL_SAMPLES,
            timeoutMs: Math.min(limits.measurementWallClockMs, MAX_ANALYSIS_MS),
            signal: session.controller.signal,
            onAnalysisStarted: () => {
                analyses = 1;
            },
        });
        if (session.disposed || session.controller.signal.aborted) {
            return refuse('cancelled');
        }
        if (source.status === 'failed') {
            if (source.code === 'stale-source') {
                dispose();
            }
            return refuse(source.code);
        }
        if (source.identity.clipId !== parsed.clipId || source.identity.projectId !== projectId) {
            dispose();
            return refuse('stale-source');
        }
        const entry = { source, sensitivity: parsed.sensitivity };
        session.entries.set(key, entry);
        return { status: 'ready', entry };
    } catch {
        return refuse(session.disposed ? 'cancelled' : 'analysis-failed');
    } finally {
        session.pending.delete(key);
        admission.settle({ renderJobs: 0, analyses });
    }
}

function entryIsCurrent(entry: Entry): boolean {
    try {
        return entry.source.isCurrent();
    } catch {
        return false;
    }
}

function pageReceipt(
    session: Session,
    call: Call,
    entry: Entry,
    page: { offset: number; cursor?: string }
): ApplicationToolReceipt {
    const { source } = entry;
    const hits = source.hits.slice(page.offset, page.offset + PAGE_SIZE).map((hit) => ({
        sourceSeconds: hit.sampleOffset / source.identity.sampleRate,
        confidence: hit.confidence,
    }));
    const nextOffset = page.offset + hits.length;
    const nextCursor = nextOffset < source.hits.length ? `${session.nonce}.${crypto.randomUUID()}` : null;
    const receipt: ApplicationToolReceipt = {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: call.callId,
        toolName: ANALYSIS_DETECT_TRANSIENTS_TOOL_NAME,
        turn: call.turn,
        status: 'success',
        revision: session.sourceRevisionDigest,
        data: {
            kind: 'transient-onset-read',
            schemaVersion: 1,
            ...source.identity,
            sourceRevisionDigest: session.sourceRevisionDigest,
            timeAxis: 'source-buffer',
            sensitivity: entry.sensitivity,
            totalHitCount: source.hits.length,
            coverage: {
                startFrame: 0,
                endFrame: source.identity.frameCount,
                offset: page.offset,
                endOffset: nextOffset,
            },
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
    if (page.cursor !== undefined) {
        session.cursors.delete(page.cursor);
    }
    if (nextCursor !== null) {
        session.cursors.set(nextCursor, { entry, offset: nextOffset });
    }
    return receipt;
}

async function executeRead(session: Session, call: Call, dispose: () => void): Promise<ApplicationToolReceipt> {
    if (call.call.name !== ANALYSIS_DETECT_TRANSIENTS_TOOL_NAME) {
        return failure(call, 'invalid-tool-name');
    }
    const parsed = parseArguments(call.call.arguments);
    if (parsed === null) {
        return failure(call, 'invalid-tool-arguments');
    }
    if (session.disposed || session.controller.signal.aborted) {
        return failure(call, 'cancelled');
    }
    const projectId = session.projectId;
    if (!projectId || session.input.projectRevision.length === 0) {
        return failure(call, 'stale-source');
    }
    const requestedPage = parsed.cursor === undefined ? undefined : session.cursors.get(parsed.cursor);
    if (
        parsed.cursor !== undefined &&
        (requestedPage === undefined ||
            requestedPage.entry.source.identity.clipId !== parsed.clipId ||
            requestedPage.entry.sensitivity !== parsed.sensitivity)
    ) {
        return failure(call, 'invalid-cursor');
    }
    let entry = requestedPage?.entry ?? session.entries.get(cacheKey(parsed.clipId, parsed.sensitivity));
    if (entry === undefined) {
        const result = await readEntry({ session, call, parsed, projectId, dispose });
        if (result.status === 'failed') {
            return result.receipt;
        }
        entry = result.entry;
    }
    if (!entryIsCurrent(entry) || session.disposed) {
        dispose();
        return failure(call, 'stale-source');
    }
    return pageReceipt(session, call, entry, { offset: requestedPage?.offset ?? 0, cursor: parsed.cursor });
}

/** A run-local, disposable read session. Its caller must dispose it when planning ends. */
export function executeTransientOnsetRead(input: ReadInput): {
    execute: (call: Call) => Promise<ApplicationToolReceipt>;
    dispose: () => void;
} {
    const session: Session = {
        input,
        projectId: getSettledProjectId(),
        sourceRevisionDigest: digest(input.projectRevision),
        nonce: crypto.randomUUID(),
        entries: new Map(),
        cursors: new Map(),
        pending: new Set(),
        controller: new AbortController(),
        disposed: false,
    };
    const dispose = (): void => {
        if (session.disposed) {
            return;
        }
        session.disposed = true;
        session.controller.abort();
        session.entries.clear();
        session.cursors.clear();
        session.pending.clear();
        input.signal?.removeEventListener('abort', dispose);
    };
    input.signal?.addEventListener('abort', dispose, { once: true });
    if (input.signal?.aborted) {
        dispose();
    }
    return { execute: (call) => executeRead(session, call, dispose), dispose };
}

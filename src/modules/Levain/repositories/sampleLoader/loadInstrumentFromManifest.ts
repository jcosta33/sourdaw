import { LEVAIN_SAMPLE_CHUNK_FLOATS, LEVAIN_SAMPLE_CHUNKS_IN_FLIGHT } from '#/infra/audioWorklet/levainSampleChunk';
import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';

import { decodedBankResource } from './decodedBankResource';
import { type SampleLodConfig } from './helpers';

import type { DecodedBank, DecodedBankLease } from './createDecodedBankResource';

export type { ManifestArticulation, ManifestZone, SampleManifest } from './sampleManifest';

export const DEFAULT_LOD: SampleLodConfig = {
    maxMics: 0,
    maxRoundRobins: 0,
};

let bankLoadSequence = 0;

type SampleBankHandshake = {
    uploadRequired: Promise<boolean>;
    completed: Promise<void>;
    /** Cancel the load on the worklet; false when the abort could not be posted because the port is closed. */
    cancel: () => boolean;
    /**
     * Tell the handshake that `buildZoneMap` has been posted for this load —
     * the point from which the worklet may commit the bank before it ever
     * sees a later abort. Must be called right after that `postMessage`, and
     * only then: see `onAbort`'s use of the flag it sets.
     */
    markZoneMapPosted: () => void;
};

function allocateBankLoadToken(): number {
    if (bankLoadSequence >= Number.MAX_SAFE_INTEGER) {
        throw new Error('Levain sample-bank load token capacity exhausted');
    }
    bankLoadSequence += 1;
    return bankLoadSequence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/** The worklet's own end-of-life messages: `error` after a fault, `disposed` after teardown. */
function isProcessorEnd(message: Record<string, unknown>): boolean {
    return message.type === 'disposed' || message.type === 'error';
}

function processorEndedError(message: Record<string, unknown>): Error {
    const detail = typeof message.message === 'string' ? `: ${message.message}` : '';
    return new Error(`Levain processor ended during sample-bank loading${detail}`);
}

function createSampleBankHandshake(
    nodePort: MessagePort,
    loadToken: number,
    signal?: AbortSignal
): SampleBankHandshake {
    function ignoreUploadDecision(_uploadRequired: boolean): void {}
    function ignoreError(_error: Error): void {}
    function ignoreCompletion(): void {}

    let uploadSettled = false;
    let completedSettled = false;
    // Set once `buildZoneMap` has been posted for this load (see
    // `markZoneMapPosted`) — from that point the worklet may already be
    // committing, so `onAbort` stops settling this handshake locally.
    let zoneMapPosted = false;
    // Set once `onAbort` has deferred to the worklet instead of rejecting
    // locally, so a later `sampleBankError` for this token is known to be the
    // abort's own answer (reject with the abort's reason) rather than an
    // unrelated commit failure (reject with the worklet's own message).
    let awaitingWorkletAfterAbort = false;
    let resolveUpload = ignoreUploadDecision;
    let rejectUpload = ignoreError;
    let resolveCompleted = ignoreCompletion;
    let rejectCompleted = ignoreError;

    const uploadRequired = new Promise<boolean>((resolve, reject) => {
        resolveUpload = resolve;
        rejectUpload = reject;
    });
    const completed = new Promise<void>((resolve, reject) => {
        resolveCompleted = resolve;
        rejectCompleted = reject;
    });
    void uploadRequired.catch(() => {});
    void completed.catch(() => {});

    function cleanup(): void {
        nodePort.removeEventListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
    }
    function resolveAbortReason(): Error {
        const reason: unknown = signal?.reason;
        return reason instanceof Error ? reason : new DOMException('Levain sample-bank load aborted', 'AbortError');
    }
    function reject(error: Error): void {
        if (!uploadSettled) {
            uploadSettled = true;
            rejectUpload(error);
        }
        if (!completedSettled) {
            completedSettled = true;
            rejectCompleted(error);
        }
        cleanup();
    }
    function onMessage(event: MessageEvent<unknown>): void {
        const message = event.data;
        if (!isRecord(message)) {
            return;
        }
        if (isProcessorEnd(message)) {
            reject(processorEndedError(message));
            return;
        }
        if (message.loadToken !== loadToken) {
            return;
        }
        if (message.type === 'sampleBankUploadDecision' && typeof message.uploadRequired === 'boolean') {
            if (!uploadSettled) {
                uploadSettled = true;
                resolveUpload(message.uploadRequired);
            }
            return;
        }
        if (message.type === 'sampleBankLoaded') {
            if (!uploadSettled) {
                reject(new Error('Levain processor committed a sample bank before its upload decision'));
                return;
            }
            if (!completedSettled) {
                completedSettled = true;
                resolveCompleted();
                cleanup();
            }
            return;
        }
        if (message.type === 'sampleBankError') {
            if (awaitingWorkletAfterAbort) {
                // This load's own abort matched a still-pending token on the
                // worklet (levainProcessor.ts `abortSampleBank` case,
                // ~:513-517 — `_rejectBankLoad`, ~:365-376) and lost the race
                // to a commit; report the abort itself rather than the
                // worklet's generic wording.
                reject(resolveAbortReason());
                return;
            }
            const detail = typeof message.message === 'string' ? `: ${message.message}` : '';
            reject(new Error(`Levain sample-bank load failed${detail}`));
        }
    }
    // False once an `abortSampleBank` post found the port closed.
    let abortDelivered = true;
    function onAbort(): void {
        if (uploadSettled && completedSettled) {
            return;
        }
        let delivered = true;
        try {
            nodePort.postMessage({ type: 'abortSampleBank', loadToken });
        } catch {
            // The port is already closed: no terminal message can ever
            // arrive, so local cancellation must settle here regardless of
            // whether `buildZoneMap` was posted.
            delivered = false;
            abortDelivered = false;
        }
        if (zoneMapPosted && delivered) {
            // Once `buildZoneMap` is posted the worklet may already be
            // committing: `_buildZoneMap`/`_completeSampleBankLoad`
            // (levainProcessor.ts ~:293-343, ~:285-291) clear
            // `_bankLoadToken` and reply before this `abortSampleBank` is even
            // dispatched, and a matched abort that lands after commit is
            // already a no-op there too (~:513-517). Settling this promise
            // locally now could report a rejection for a bank the engine goes
            // on to commit, so only the worklet's own terminal answer —
            // `sampleBankLoaded` (resolve), or `sampleBankError`/`error`/
            // `disposed` (reject, all handled above) — may settle it from
            // here on.
            awaitingWorkletAfterAbort = true;
            return;
        }
        reject(resolveAbortReason());
    }

    nodePort.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
        onAbort();
    }

    return {
        uploadRequired,
        completed,
        cancel: () => {
            onAbort();
            return abortDelivered;
        },
        markZoneMapPosted: () => {
            zoneMapPosted = true;
        },
    };
}

/**
 * What a port's loads have in common. `tail` settles when the newest load that
 * registered is over, and every load registers before it posts
 * `beginSampleBank`, so a load that waits on `tail` waits for every load that
 * can still commit. A load is over when the worklet has given its terminal
 * answer for a bank that did not commit, or when the release loop of a bank
 * that did has finished. `processorEnded` keeps the first end-of-life message:
 * a processor that faulted or was disposed gives no later bank answer (a
 * disposed one posts nothing for a load's messages, a faulted one posts its
 * `error` again), so no later load can complete. ADR 0052's Message contract
 * tables every answer by state.
 */
type PortLoads = {
    tail: Promise<void>;
    processorEnded: Error | null;
};

const portLoads = new WeakMap<MessagePort, PortLoads>();

function portLoadsOf(nodePort: MessagePort): PortLoads {
    const known = portLoads.get(nodePort);
    if (known) {
        return known;
    }
    const created: PortLoads = { tail: Promise.resolve(), processorEnded: null };
    nodePort.addEventListener('message', (event: MessageEvent<unknown>) => {
        const message = event.data;
        if (isRecord(message) && isProcessorEnd(message)) {
            created.processorEnded ??= processorEndedError(message);
        }
    });
    portLoads.set(nodePort, created);
    return created;
}

/**
 * Ask the worklet to free the bank this load retired, one bounded step per
 * message, re-asking while it answers that more is left, then call `onOver`.
 * The retired bank is the one a commit displaced, or the staged bank an abort
 * discarded; neither the commit nor the abort frees anything, and the load
 * that started this does not wait on the loop: it has already settled. The
 * port delivers this after any `abortSampleBank` the load posted, so the
 * request always finds the bank retired. A closed port, or a processor that
 * has ended or ends meanwhile, stops the loop too: it gives no
 * `retiredBankReleased`, so no answer would come and every later load on the
 * port would wait for it.
 */
function releaseRetiredBank(nodePort: MessagePort, loads: PortLoads, loadToken: number, onOver: () => void): void {
    function stop(): void {
        nodePort.removeEventListener('message', onMessage);
        onOver();
    }
    function request(): void {
        try {
            nodePort.postMessage({ type: 'releaseRetiredBank', loadToken });
        } catch {
            stop();
        }
    }
    function onMessage(event: MessageEvent<unknown>): void {
        const message = event.data;
        if (!isRecord(message)) {
            return;
        }
        if (isProcessorEnd(message)) {
            stop();
            return;
        }
        if (message.type !== 'retiredBankReleased' || message.loadToken !== loadToken) {
            return;
        }
        if (message.done === true) {
            stop();
            return;
        }
        request();
    }

    if (loads.processorEnded) {
        onOver();
        return;
    }
    nodePort.addEventListener('message', onMessage);
    request();
}

type ChunkPacer = {
    /** Resolve when a chunk may be posted; reject if the load was aborted, the worklet refused it or the processor ended. */
    reserve: () => Promise<void>;
    /**
     * The load is over. Its unacknowledged chunks are still queued on the
     * worklet's port, ahead of any abort, so it keeps their credits until the
     * worklet has passed them (see `createChunkPacer`); `abortDelivered` false
     * means the port is closed and nothing more will be answered.
     */
    dispose: (abortDelivered: boolean) => void;
};

type BudgetWaiter = { resolve: (granted: boolean) => void; granted: boolean };

/**
 * The credits that bound every Levain chunk upload on this main-thread realm.
 * All Levain processors of one `AudioContext` share one worklet render thread,
 * and devices load in parallel, so a per-load limit would let N loads queue N
 * times the limit on that thread. The loader cannot derive a context from the
 * `MessagePort` it is handed, so this one budget covers every context in the
 * realm: the app has exactly one live context, and an offline render's loads
 * only share it conservatively (they queue behind each other, they never get
 * more than the limit).
 *
 * A credit is held from posting a chunk until the worklet acknowledges it. A
 * load that ends with chunks unacknowledged (aborted, failed) keeps those
 * credits: its chunks are still queued ahead of its abort on the port, and the
 * worklet still copies them. They return one per acknowledgement, and all at
 * once at the first answer that must follow those chunks, or when the port is
 * closed or the processor ends. Waiters are served first come, first served: a
 * returned credit goes straight to the oldest waiter, and a new reservation
 * never takes a free credit past a queue.
 */
const chunkBudget = { credits: LEVAIN_SAMPLE_CHUNKS_IN_FLIGHT, waiters: [] as BudgetWaiter[] };

function giveBackChunkCredit(): void {
    const next = chunkBudget.waiters.shift();
    if (next) {
        next.granted = true;
        next.resolve(true);
        return;
    }
    chunkBudget.credits += 1;
}

/** Take `waiter` out of the queue; false when it was already served. */
function withdrawFromChunkBudget(waiter: BudgetWaiter): boolean {
    const index = chunkBudget.waiters.indexOf(waiter);
    if (index === -1) {
        return false;
    }
    chunkBudget.waiters.splice(index, 1);
    return true;
}

/**
 * Hold a load to the shared `chunkBudget` of `LEVAIN_SAMPLE_CHUNKS_IN_FLIGHT`
 * chunks the worklets have not yet acknowledged with `sampleChunkWritten`.
 * A wait ends on a credit, and just as promptly on the abort signal, a
 * `sampleBankError` for this load, or the processor's `error`/`disposed`: a
 * processor that stops answering must not leave the load waiting for an
 * acknowledgement that will never come. Messages carrying another load's
 * token are not this load's to act on.
 *
 * The pacer outlives its load while it still holds credits. The worklet reads
 * its port in order, so once the load's chunks are passed it answers the
 * token's `sampleBankError` (the abort's reply), or the `retiredBankReleased`
 * the loader asks for next; the first of those, or the processor ending, hands
 * back whatever is still held, and the listener is removed.
 */
function createChunkPacer(nodePort: MessagePort, loadToken: number, signal?: AbortSignal): ChunkPacer {
    let held = 0;
    let failure: Error | null = null;
    let queued: BudgetWaiter | null = null;
    let ended = false;

    function stopListeningWhenDone(): void {
        if (ended && held === 0) {
            nodePort.removeEventListener('message', onMessage);
        }
    }
    function fail(error: Error): void {
        failure ??= error;
        if (queued && withdrawFromChunkBudget(queued)) {
            queued.resolve(false);
        }
    }
    function passedAllChunks(): void {
        for (; held > 0; held -= 1) {
            giveBackChunkCredit();
        }
        stopListeningWhenDone();
    }
    function onMessage(event: MessageEvent<unknown>): void {
        const message = event.data;
        if (!isRecord(message)) {
            return;
        }
        if (isProcessorEnd(message)) {
            fail(processorEndedError(message));
            passedAllChunks();
            return;
        }
        if (message.loadToken !== loadToken) {
            return;
        }
        if (message.type === 'sampleChunkWritten') {
            if (held > 0) {
                held -= 1;
                giveBackChunkCredit();
            }
            stopListeningWhenDone();
            return;
        }
        if (message.type === 'sampleBankError') {
            const detail = typeof message.message === 'string' ? `: ${message.message}` : '';
            fail(new Error(`Levain sample-bank load failed${detail}`));
            passedAllChunks();
            return;
        }
        if (message.type === 'retiredBankReleased') {
            passedAllChunks();
        }
    }
    async function reserve(): Promise<void> {
        if (failure) {
            throw failure;
        }
        signal?.throwIfAborted();
        if (chunkBudget.credits > 0 && chunkBudget.waiters.length === 0) {
            chunkBudget.credits -= 1;
            held += 1;
            return;
        }
        const answered = Promise.withResolvers<boolean>();
        const waiter: BudgetWaiter = { resolve: answered.resolve, granted: false };
        queued = waiter;
        chunkBudget.waiters.push(waiter);
        let granted: boolean;
        try {
            granted = await raceAbortSignal(answered.promise, signal);
        } catch (error) {
            // Aborted. A credit already handed over was not used: pass it on.
            // A waiter a failure removed was handed none, so it has nothing to pass on.
            if (!withdrawFromChunkBudget(waiter) && waiter.granted) {
                giveBackChunkCredit();
            }
            throw error;
        } finally {
            queued = null;
        }
        if (!granted) {
            throw failure ?? new Error('Levain sample upload stopped waiting for a chunk credit');
        }
        held += 1;
    }

    nodePort.addEventListener('message', onMessage);
    return {
        reserve,
        dispose: (abortDelivered) => {
            ended = true;
            fail(new Error('Levain sample upload ended'));
            if (!abortDelivered) {
                passedAllChunks();
            }
            stopListeningWhenDone();
        },
    };
}

/**
 * Post one decoded sample as `beginSample`, its PCM in `sampleChunk` messages
 * of at most `LEVAIN_SAMPLE_CHUNK_FLOATS` floats, then `sealSample`, in that
 * order on one port. The worklet reserves the sample's storage once at begin
 * and copies one chunk per message, so no message holds the render thread for a
 * whole sample's copy.
 *
 * Each chunk is a copy of its slice, transferred: posting a view of the bank's
 * shared buffer would clone the whole underlying buffer, and the decoded bank
 * stays cached for later loads, so its own buffer cannot be handed away.
 *
 * Each chunk waits for a slot from `pacer`, so the worklet never holds more
 * than `LEVAIN_SAMPLE_CHUNKS_IN_FLIGHT` queued chunks and cannot drain a long
 * run of them between two render quanta.
 */
async function uploadSampleInChunks(
    nodePort: MessagePort,
    loadToken: number,
    sampleId: number,
    decoded: { data: Float32Array; frameCount: number; channels: number; sampleRate: number },
    pacer: ChunkPacer
): Promise<void> {
    nodePort.postMessage({
        type: 'beginSample',
        loadToken,
        sampleId,
        frameCount: decoded.frameCount,
        channels: decoded.channels,
        sampleRate: decoded.sampleRate,
    });
    for (let offset = 0; offset < decoded.data.length; offset += LEVAIN_SAMPLE_CHUNK_FLOATS) {
        await pacer.reserve();
        const data = decoded.data.slice(offset, offset + LEVAIN_SAMPLE_CHUNK_FLOATS);
        nodePort.postMessage({ type: 'sampleChunk', loadToken, sampleId, data }, [data.buffer]);
    }
    nodePort.postMessage({ type: 'sealSample', loadToken, sampleId });
}

export type LoadInstrumentFromManifestInput = {
    manifestUrl: string;
    basePath: string;
    expectedInstrumentId: string;
    nodePort: MessagePort;
    lod?: SampleLodConfig;
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
};

// ---------------------------------------------------------------------------
// Manifest loader
// ---------------------------------------------------------------------------

/**
 * Load a complete instrument from a manifest file.
 * Negotiates shared-bank ownership, uploads PCM only for the elected owner,
 * and resolves only after the worklet commits the bank.
 *
 * @param manifestUrl URL to the JSON manifest
 * @param basePath Base path for sample file URLs
 * @param nodePort The worklet node's MessagePort
 * @param lod LOD configuration for memory management
 * @param onProgress Optional progress callback (0-1)
 * @param signal Optional abort signal. When a newer load supersedes this one,
 *   the caller aborts it; per-load tokens fence any messages already queued for
 *   the superseded transaction from the replacement bank.
 * @returns The decoded bank the worklet committed, or undefined when the
 *   caller's own pre-flight checks abort this load before it ever asks the
 *   worklet to negotiate a bank (a superseded load resolves rather than
 *   throwing; see the `signal` fencing above). Once `buildZoneMap` has been
 *   posted, an abort no longer settles this promise locally — the worklet may
 *   already be delivering its commit — so only the worklet's own terminal
 *   answer settles it from there: `sampleBankLoaded` resolves with the bank
 *   (even though aborted), and `sampleBankError`, `error`, or `disposed`
 *   rejects with the abort's reason or the worklet's own failure.
 */
export async function loadInstrumentFromManifest({
    manifestUrl,
    basePath,
    expectedInstrumentId,
    nodePort,
    lod = DEFAULT_LOD,
    onProgress,
    signal,
}: LoadInstrumentFromManifestInput): Promise<DecodedBank | undefined> {
    let lease: DecodedBankLease;
    try {
        lease = await decodedBankResource.acquire({
            manifestUrl,
            basePath,
            expectedInstrumentId,
            lod,
            onProgress,
            signal,
        });
    } catch (error) {
        if (signal?.aborted) {
            return undefined;
        }
        throw error;
    }
    if (signal?.aborted) {
        lease.release();
        return undefined;
    }

    const bank = lease.bank;
    // Register with the port before anything is posted, so a load that starts
    // while this one may still commit waits for it (see `PortLoads`).
    const loads = portLoadsOf(nodePort);
    const previous = loads.tail;
    const over = Promise.withResolvers<void>();
    loads.tail = over.promise;
    // Set once `beginSampleBank` is posted: from then on the worklet holds a
    // bank for this token that someone must free, whether the load commits or not.
    let postedLoadToken: number | null = null;
    let releaseStarted = false;
    let handshake: SampleBankHandshake | null = null;
    let completed = false;
    // Paces the chunk uploads of this load; made when the first sample uploads.
    let chunkPacer: ChunkPacer | null = null;
    try {
        // Hold this load's `beginSampleBank` until every earlier load on the
        // port is over, the bank the last one displaced fully freed a bounded
        // step at a time; begin would otherwise free what is left in one call
        // on the render thread. An abort ends the wait (the promise itself
        // never rejects).
        await raceAbortSignal(previous, signal).catch(() => undefined);
        if (signal?.aborted) {
            return undefined;
        }
        if (loads.processorEnded) {
            // The processor gives no bank answer from here on, so a begin
            // would never be answered.
            throw loads.processorEnded;
        }
        const loadToken = allocateBankLoadToken();
        handshake = createSampleBankHandshake(nodePort, loadToken, signal);
        nodePort.postMessage({
            type: 'beginSampleBank',
            bankKey: bank.bankKey,
            instrumentId: bank.instrumentId,
            loadToken,
        });
        postedLoadToken = loadToken;

        const uploadRequired = await handshake.uploadRequired;
        signal?.throwIfAborted();
        const sampleIdMap = new Map<string, number>();
        for (const [sampleId, file] of bank.files.entries()) {
            signal?.throwIfAborted();
            const decoded = bank.samples.get(file);
            if (!decoded) {
                throw new Error(`Decoded Levain bank ${bank.instrumentId}@${bank.version} is missing ${file}`);
            }
            sampleIdMap.set(file, sampleId);
            if (uploadRequired) {
                chunkPacer ??= createChunkPacer(nodePort, loadToken, signal);
                await uploadSampleInChunks(nodePort, loadToken, sampleId, decoded, chunkPacer);
            }
        }

        let zoneId = 0;
        for (const { zone, articulationId } of bank.zones) {
            signal?.throwIfAborted();
            const sampleId = sampleIdMap.get(zone.file);
            if (sampleId === undefined) {
                throw new Error(`Decoded Levain bank ${bank.instrumentId}@${bank.version} has no id for ${zone.file}`);
            }
            const decoded = bank.samples.get(zone.file);
            if (!decoded) {
                throw new Error(`Decoded Levain bank ${bank.instrumentId}@${bank.version} is missing ${zone.file}`);
            }

            let loopMode: 'none' | 'forward' | 'pingpong' = 'none';
            let loopStart = 0;
            let loopEnd = 0;
            let loopCrossfade = 0;
            if (zone.loop.mode !== 'none') {
                loopMode = zone.loop.mode;
                loopStart = zone.loop.startFrame;
                loopEnd = zone.loop.endFrame === 'sample-end' ? decoded.frameCount : zone.loop.endFrame;
                loopCrossfade = zone.loop.crossfadeFrames;
            }
            nodePort.postMessage({
                type: 'addZone',
                loadToken,
                zoneId,
                sampleId,
                articulationId,
                rootNote: zone.rootNote,
                loKey: zone.loKey,
                hiKey: zone.hiKey,
                loVel: zone.loVel,
                hiVel: zone.hiVel,
                rrPos: zone.rrPos,
                rrLen: zone.rrLen,
                micId: zone.micId,
                isRelease: zone.isRelease,
                loopMode,
                loopStart,
                loopEnd,
                loopCrossfade,
                gainDb: zone.gainDb,
                attack: zone.attack,
                decay: zone.decay,
                sustain: zone.sustain,
                release: zone.release,
            });
            zoneId++;
        }

        // Recorded interval samples. The engine prefers one of these over its
        // crossfade fallback for any slur whose (interval, dynamic, transition
        // type) it can match.
        //
        // Grouped with the other staging messages for readability, not because
        // the position matters: `LevainEngine::add_legato_transition` adds to
        // the pending bank's transition store the same way `add_zone` adds to
        // its zone map, and `commit_sample_bank` swaps that store in, so a
        // message landing either side of `buildZoneMap` still takes.
        // `loadToken` is what makes a transition from an abandoned load stale.
        for (const transition of bank.legatoTransitions) {
            signal?.throwIfAborted();
            const sampleId = sampleIdMap.get(transition.file);
            if (sampleId === undefined) {
                throw new Error(
                    `Decoded Levain bank ${bank.instrumentId}@${bank.version} has no id for ${transition.file}`
                );
            }
            nodePort.postMessage({
                type: 'addLegatoTransition',
                loadToken,
                sampleId,
                interval: transition.interval,
                transitionType: transition.transitionType,
                dynamic: transition.dynamic,
                crossfadeOutMs: transition.crossfadeOutMs,
            });
        }

        nodePort.postMessage({
            type: 'buildZoneMap',
            loadToken,
            numArticulations: bank.numArticulations,
            numMics: bank.numMics,
        });
        // From here the worklet may commit before it ever sees a later abort
        // (see `onAbort`'s use of this flag) — tell the handshake so a
        // superseding abort waits for the worklet's own terminal message
        // instead of rejecting a load the engine goes on to commit.
        handshake.markZoneMapPosted();
        await handshake.completed;
        completed = true;
        releaseStarted = true;
        releaseRetiredBank(nodePort, loads, loadToken, over.resolve);
        return bank;
    } finally {
        // The abort goes out before the pacer is told the load is over: it
        // learns from it whether the worklet will still answer.
        const abortDelivered = handshake && !completed ? handshake.cancel() : true;
        chunkPacer?.dispose(abortDelivered);
        if (!releaseStarted) {
            if (postedLoadToken === null) {
                // It never posted a begin: it is over once the loads before it are.
                over.resolve(previous);
            } else {
                // The worklet retired the bank this load staged when it aborted
                // it, or committed it before the abort arrived. Either way the
                // load is over only once that bank is freed, and the port
                // delivers this request after the abort.
                releaseRetiredBank(nodePort, loads, postedLoadToken, over.resolve);
            }
        }
        lease.release();
    }
}

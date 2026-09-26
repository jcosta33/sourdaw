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
    cancel: () => void;
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
        if (message.type === 'disposed' || message.type === 'error') {
            const detail = typeof message.message === 'string' ? `: ${message.message}` : '';
            reject(new Error(`Levain processor ended during sample-bank loading${detail}`));
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
        cancel: onAbort,
        markZoneMapPosted: () => {
            zoneMapPosted = true;
        },
    };
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
    let handshake: SampleBankHandshake | null = null;
    let completed = false;
    try {
        const loadToken = allocateBankLoadToken();
        handshake = createSampleBankHandshake(nodePort, loadToken, signal);
        nodePort.postMessage({
            type: 'beginSampleBank',
            bankKey: bank.bankKey,
            instrumentId: bank.instrumentId,
            loadToken,
        });

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
                nodePort.postMessage({
                    type: 'addSample',
                    loadToken,
                    sampleId,
                    data: decoded.data,
                    frameCount: decoded.frameCount,
                    channels: decoded.channels,
                    sampleRate: decoded.sampleRate,
                });
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
        // the position matters: `LevainEngine::add_legato_transition` pushes
        // into the pending bank the same way `add_zone` does, and
        // `commit_sample_bank` rebuilds the whole transition store from that
        // list, so a message landing either side of `buildZoneMap` still takes.
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
        return bank;
    } finally {
        if (handshake && !completed) {
            handshake.cancel();
        }
        lease.release();
    }
}

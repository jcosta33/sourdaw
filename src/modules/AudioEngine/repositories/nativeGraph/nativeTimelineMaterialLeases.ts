import { logger } from '#/infra/logger/appLogger';

import { type AudioGraphCommand } from '../../models/AudioGraphBackend';
import { audioBufferCache } from '../../stores/audioBufferCache';

import { interleaveAudioBufferPcm } from './interleaveAudioBufferPcm';
import {
    type NativeGraphTransport,
    type NativeTimelineLifecycleRequest,
    type NativeTimelineMaterialDescriptor,
} from './nativeGraphTransport';

type CapturedMaterial = Readonly<{
    descriptor: NativeTimelineMaterialDescriptor;
    buffer: AudioBuffer;
    isCurrent: () => boolean;
}>;
type Claim = Readonly<{
    lease: string;
    versions: ReadonlyMap<string, string>;
    sources: ReadonlyMap<string, CapturedMaterial>;
    sampleIds: readonly string[];
}>;
type MaterialConsumer = Readonly<{
    capture(commands: readonly AudioGraphCommand[]): ReadonlyMap<string, CapturedMaterial>;
    assertOpen(): void;
    isClosed(): boolean;
    run<Result>(operation: () => Promise<Result>): Promise<Result>;
    prepare(
        commands: readonly AudioGraphCommand[],
        replace?: boolean,
        captured?: ReadonlyMap<string, CapturedMaterial>
    ): Promise<Claim>;
    accept(claim: Claim): Promise<void>;
    decline(claim: Claim): Promise<void>;
    context(): Readonly<{ lease: string }>;
    dispose(): void;
}>;
type Owner = {
    closed: boolean;
    native?: Promise<string>;
    transport?: NativeGraphTransport;
    pending: Set<Promise<unknown>>;
    consumers: Set<MaterialConsumer>;
    retirement?: Promise<void>;
};

// Only the real synchronous snapshot producer (and owned fixtures) can issue
// this witness. A bare mutable AudioBuffer is never an immutable-content claim.
const ownedSnapshots = new WeakMap<object, Readonly<{ sourceId: string; version: string; owner: Owner }>>();
const RETIREMENT_TIMEOUT_MS = 10_000;
const RETIREMENT_POLL_MS = 20;

function newOwner(): Owner {
    return { closed: false, pending: new Set(), consumers: new Set() };
}

let currentOwner = newOwner();

function requireOpen(owner: Owner, closed = false): void {
    if (owner.closed || closed) {
        throw new Error('Native timeline material owner or consumer is closed');
    }
}

function record(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
        throw new Error('Native timeline lifecycle returned a malformed receipt');
    }
    return value as Record<string, unknown>;
}

function token(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
        throw new Error('Native timeline lifecycle returned an invalid token');
    }
    return value;
}

async function control(
    transport: NativeGraphTransport,
    request: NativeTimelineLifecycleRequest
): Promise<Record<string, unknown>> {
    if (!transport.timelineSampleLifecycle) {
        throw new Error('Native host does not support timeline material leases; rebuild the native addon');
    }
    return record(await transport.timelineSampleLifecycle(request));
}

function open(owner: Owner, transport: NativeGraphTransport): Promise<string> {
    requireOpen(owner);
    if (!owner.native) {
        owner.transport = transport;
        owner.native = control(transport, { action: 'open' }).then((receipt) => token(receipt.owner));
    }
    return owner.native;
}

function track<Result>(owner: Owner, operation: Promise<Result>): Promise<Result> {
    owner.pending.add(operation);
    void operation.finally(() => owner.pending.delete(operation)).catch(() => undefined);
    return operation;
}

function materialKey(descriptor: NativeTimelineMaterialDescriptor): string {
    return JSON.stringify([descriptor.sourceId, descriptor.version]);
}

function ownSnapshot(
    sourceId: string,
    buffer: Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>,
    original?: AudioBuffer
): void {
    const owner = currentOwner;
    requireOpen(owner);
    const publication = original ? audioBufferCache.readRuntimeMaterialPublication(sourceId, original) : undefined;
    const prior = ownedSnapshots.get(buffer);
    if (prior?.owner === owner && prior.sourceId === sourceId) {
        return;
    }
    ownedSnapshots.set(buffer, {
        sourceId,
        owner,
        version: publication === undefined ? `snapshot-${crypto.randomUUID()}` : `publication-${publication}`,
    });
}

function captureMaterial(sourceId: string, buffer: AudioBuffer, owner: Owner): CapturedMaterial {
    const publication = audioBufferCache.readRuntimeMaterialPublication(sourceId, buffer);
    const snapshot = ownedSnapshots.get(buffer);
    if (publication === undefined && (!snapshot || snapshot.owner !== owner || snapshot.sourceId !== sourceId)) {
        throw new Error(`Native clip source "${sourceId}" needs an authenticated publication or owned snapshot`);
    }
    if (buffer.numberOfChannels !== 1 && buffer.numberOfChannels !== 2) {
        throw new Error(`Native clip source "${sourceId}" must be mono or stereo`);
    }
    const version = publication === undefined ? snapshot?.version : `publication-${publication}`;
    if (!version) {
        throw new Error('Native timeline snapshot has no material version');
    }
    let isCurrent = (): boolean => !owner.closed;
    if (publication !== undefined) {
        isCurrent = () => audioBufferCache.readRuntimeMaterialPublication(sourceId, buffer) === publication;
    }
    return {
        buffer,
        descriptor: {
            sourceId,
            version,
            channels: buffer.numberOfChannels,
            frames: buffer.length,
            sampleRate: buffer.sampleRate,
        },
        isCurrent,
    };
}

function captureSources(
    commands: readonly AudioGraphCommand[],
    owner: Owner,
    closed: boolean
): ReadonlyMap<string, CapturedMaterial> {
    requireOpen(owner, closed);
    const captured = new Map<string, CapturedMaterial>();
    for (const command of commands) {
        if (command.kind !== 'schedule-clip' || !command.playback.source.buffer) {
            continue;
        }
        const { sourceId, buffer } = command.playback.source;
        const row = captureMaterial(sourceId, buffer, owner);
        const previous = captured.get(sourceId);
        if (previous && previous.descriptor.version !== row.descriptor.version) {
            throw new Error(`Native batch carries conflicting versions of "${sourceId}"`);
        }
        captured.set(sourceId, row);
    }
    return captured;
}

function prepareSources(
    commands: readonly AudioGraphCommand[],
    replace: boolean,
    accepted: Claim | undefined,
    captured: ReadonlyMap<string, CapturedMaterial>
) {
    const sources = new Map<string, CapturedMaterial>(replace ? [] : accepted?.sources);
    const versions = new Map<string, string>();
    // Capture object/version identity before opening an owner or preparing
    // a lease. A bare id can only reuse this consumer's accepted material.
    for (const command of commands) {
        if (command.kind !== 'schedule-clip') {
            continue;
        }
        const { sourceId, buffer } = command.playback.source;
        let source: CapturedMaterial | undefined;
        if (buffer) {
            source = captured.get(sourceId);
        } else {
            source = [...sources.values()].findLast((row) => row.descriptor.sourceId === sourceId);
        }
        if (!source) {
            throw new Error(`Native clip source "${sourceId}" needs its exact decoded material`);
        }
        const prior = versions.get(sourceId);
        if (prior && prior !== source.descriptor.version) {
            throw new Error(`Native batch carries conflicting versions of "${sourceId}"`);
        }
        if (buffer && !source.isCurrent()) {
            throw new Error(`Native clip source "${sourceId}" publication changed before preparation`);
        }
        sources.set(materialKey(source.descriptor), source);
        versions.set(sourceId, source.descriptor.version);
    }
    return { sources, versions };
}

function readMissingMaterial(value: unknown, sources: ReadonlyMap<string, CapturedMaterial>, seen: Set<string>) {
    const row = record(value);
    const sourceId = token(row.sourceId);
    const version = token(row.version);
    const key = JSON.stringify([sourceId, version]);
    const source = sources.get(key);
    if (
        !source ||
        seen.has(key) ||
        row.frames !== source.descriptor.frames ||
        row.channels !== source.descriptor.channels ||
        row.sampleRate !== source.descriptor.sampleRate
    ) {
        throw new Error('Native timeline lease returned material outside the captured request');
    }
    seen.add(key);
    return { sourceId, version, source };
}

function prepareMaterialUpload(lease: string, sourceId: string, version: string, source: CapturedMaterial) {
    if (!source.isCurrent()) {
        throw new Error(`Native clip source "${sourceId}" publication changed before upload`);
    }
    // No await between authentication, reading PCM and handing the
    // owned raw bytes to IPC. Native material is immutable afterward.
    const material = interleaveAudioBufferPcm({ sourceId, buffer: source.buffer });
    return {
        lease,
        sampleId: sourceId,
        version,
        sampleRate: source.descriptor.sampleRate,
        channels: material.channels,
        pcm: material.pcm,
    };
}

async function releaseClaim(transport: NativeGraphTransport, claims: Set<Claim>, claim: Claim): Promise<void> {
    if (!claims.delete(claim)) {
        return;
    }
    await control(transport, { action: 'release', lease: claim.lease });
}

function readAcceptedContext(owner: Owner, closed: boolean, accepted: Claim | undefined): Readonly<{ lease: string }> {
    requireOpen(owner, closed);
    if (!accepted) {
        throw new Error('Native timeline consumer has no accepted material lease');
    }
    return { lease: accepted.lease };
}

function createConsumer(transport: NativeGraphTransport, owner: Owner = currentOwner): MaterialConsumer {
    let closed = false;
    let accepted: Claim | undefined;
    const claims = new Set<Claim>();
    let tail: Promise<unknown> = Promise.resolve();

    const release = (claim: Claim): Promise<void> => releaseClaim(transport, claims, claim);

    const consumer: MaterialConsumer = {
        capture(commands: readonly AudioGraphCommand[]): ReadonlyMap<string, CapturedMaterial> {
            return captureSources(commands, owner, closed);
        },
        assertOpen: (): void => requireOpen(owner, closed),
        isClosed: (): boolean => owner.closed || closed,
        run<Result>(operation: () => Promise<Result>): Promise<Result> {
            // Admission is visible to project retirement before queued work awaits.
            const pending = tail.then(async () => {
                requireOpen(owner, closed);
                return operation();
            });
            tail = pending.catch(() => undefined);
            return track(owner, pending);
        },
        async prepare(
            commands: readonly AudioGraphCommand[],
            replace = false,
            captured: ReadonlyMap<string, CapturedMaterial> = consumer.capture(commands)
        ): Promise<Claim> {
            requireOpen(owner, closed);
            const { sources, versions } = prepareSources(commands, replace, accepted, captured);
            const nativeOwner = await open(owner, transport);
            requireOpen(owner, closed);
            const receipt = await control(transport, {
                action: 'prepare',
                owner: nativeOwner,
                materials: Array.from(sources.values(), (row) => row.descriptor),
            });
            const lease = token(receipt.lease);
            const sent: string[] = [];
            const claim: Claim = { lease, sources, versions, sampleIds: sent };
            claims.add(claim);
            try {
                requireOpen(owner, closed);
                if (!Array.isArray(receipt.missing)) {
                    throw new TypeError('Native timeline lease has no missing-material receipt');
                }
                const seen = new Set<string>();
                for (const value of receipt.missing) {
                    const { sourceId, version, source } = readMissingMaterial(value, sources, seen);
                    requireOpen(owner, closed);
                    if (!transport.registerTimelineMaterial) {
                        throw new Error('Native host does not support fenced timeline upload');
                    }
                    const upload = prepareMaterialUpload(lease, sourceId, version, source);
                    try {
                        await transport.registerTimelineMaterial(upload);
                    } catch (error) {
                        throw new Error(
                            `register_timeline_material "${sourceId}": ${error instanceof Error ? error.message : String(error)}`,
                            { cause: error }
                        );
                    }
                    requireOpen(owner, closed);
                    sent.push(sourceId);
                }
                return claim;
            } catch (error) {
                await release(claim);
                throw error;
            }
        },
        async accept(claim: Claim): Promise<void> {
            requireOpen(owner, closed);
            const previous = accepted;
            if (previous) {
                await release(previous);
            }
            requireOpen(owner, closed);
            accepted = claim;
        },
        decline: release,
        context: () => readAcceptedContext(owner, closed, accepted),
        dispose(): void {
            if (closed) {
                return;
            }
            closed = true;
            accepted = undefined;
            owner.consumers.delete(consumer);
            // Each release is tracked, so project completion cannot hide a failed
            // bridge cleanup behind a fire-and-forget dispose signature.
            for (const claim of claims) {
                track(owner, release(claim)).catch((error: unknown) => {
                    logger.warn(new Error('Native timeline consumer release failed', { cause: error }));
                });
            }
        },
    };
    requireOpen(owner);
    owner.consumers.add(consumer);
    return consumer;
}

async function untilDeadline<Result>(promise: Promise<Result>, deadline: number): Promise<Result> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                    () => reject(new Error('Native timeline retirement did not reach its last reader')),
                    Math.max(0, deadline - Date.now())
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function retire(owner: Owner = currentOwner): Promise<void> {
    if (owner.retirement) {
        return owner.retirement;
    }
    owner.closed = true;
    if (owner === currentOwner) {
        currentOwner = newOwner();
    }
    for (const consumer of owner.consumers) {
        consumer.dispose();
    }
    const deadline = Date.now() + RETIREMENT_TIMEOUT_MS;
    owner.retirement = (async () => {
        if (!owner.native || !owner.transport) {
            await untilDeadline(Promise.allSettled([...owner.pending]), deadline);
            return;
        }
        const nativeOwner = await untilDeadline(owner.native, deadline);
        // Close natively before draining renderer work. An upload already in IPC
        // cannot resurrect this generation when it eventually reaches the pool.
        let receipt = await untilDeadline(control(owner.transport, { action: 'retire', owner: nativeOwner }), deadline);
        await untilDeadline(Promise.allSettled([...owner.pending]), deadline);
        while (true) {
            if (
                typeof receipt.complete !== 'boolean' ||
                typeof receipt.remainingReaders !== 'number' ||
                typeof receipt.pendingFence !== 'boolean'
            ) {
                throw new TypeError('Native timeline retirement returned a malformed last-reader witness');
            }
            if (receipt.complete) {
                if (receipt.remainingReaders !== 0 || receipt.pendingFence) {
                    throw new Error('Native timeline retirement contradicts its last-reader witness');
                }
                break;
            }
            await untilDeadline(new Promise<void>((resolve) => setTimeout(resolve, RETIREMENT_POLL_MS)), deadline);
            receipt = await untilDeadline(control(owner.transport, { action: 'retire', owner: nativeOwner }), deadline);
        }
    })();
    return owner.retirement;
}

/** Shared runtime only. Every reuse is re-admitted by the native pool. */
export const nativeTimelineMaterialLeases = {
    captureOwner: (): Owner => currentOwner,
    ownSnapshot,
    createConsumer,
    retire,
};

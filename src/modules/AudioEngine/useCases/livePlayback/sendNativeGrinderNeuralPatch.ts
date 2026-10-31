import { trackStore } from '#/modules/Arrangement/stores';

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type NativeGrinderModelReceipt,
} from '../../models/AudioGraphBackend';
import { getEngineTransportPosition } from '../../repositories/engineTransport/getEngineTransportPosition';

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

type Applied = Extract<AudioGraphApplyResult, { application: 'applied' }>;
type SessionWitness = Readonly<{ backend: AudioGraphBackend | null; epoch: number }>;
type Input =
    | Readonly<{
          kind: 'write';
          trackId: string;
          deviceId: string;
          modelJson: string | null;
          values: Readonly<Record<string, number>>;
      }>
    | Readonly<{ kind: 'drain'; backend: AudioGraphBackend; result: AudioGraphApplyResult; session?: SessionWitness }>;
const latestByBackend = new WeakMap<AudioGraphBackend, Map<string, object>>();

function identity(value: unknown): value is string {
    return (
        typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n
    );
}
function admitted(result: AudioGraphApplyResult): Applied {
    if (result.application !== 'applied') {
        throw new Error(result.reason);
    }
    if (!identity(result.engineId)) {
        throw new Error('Native NAM engine identity is missing');
    }
    if (!Number.isSafeInteger(result.admittedBatch) || (result.admittedBatch ?? 0) < 1) {
        throw new Error('Native NAM fence is missing or unsafe');
    }
    if (!result.grinderModels?.length || result.grinderModels.length > 16) {
        throw new Error('Native NAM model receipt is missing');
    }
    for (const model of result.grinderModels) {
        if (
            model.engineId !== result.engineId ||
            !identity(model.targetGeneration) ||
            !model.requestId ||
            !/^[0-9a-f]{64}$/.test(model.contentHash)
        ) {
            throw new Error('Native NAM model identity is invalid');
        }
    }
    return result;
}
function sameModel(a: NativeGrinderModelReceipt, b: NativeGrinderModelReceipt): boolean {
    return (
        a.engineId === b.engineId &&
        a.trackId === b.trackId &&
        a.deviceId === b.deviceId &&
        a.targetGeneration === b.targetGeneration &&
        a.requestId === b.requestId &&
        a.contentHash === b.contentHash
    );
}
function assertDrainLifetime(
    backend: AudioGraphBackend,
    epoch: number,
    sessionBackend: AudioGraphBackend | null,
    disposedReason: string
): void {
    if (backend.disposed !== false) {
        throw new Error(disposedReason);
    }
    if (nativeLiveGraphSession.rearmEpoch !== epoch || nativeLiveGraphSession.backend !== sessionBackend) {
        throw new Error('Native NAM session changed during drain');
    }
}
async function drain(
    backend: AudioGraphBackend,
    result: AudioGraphApplyResult,
    current: () => void,
    session?: SessionWitness
): Promise<void> {
    const accepted = admitted(result);
    const epoch = session ? session.epoch : nativeLiveGraphSession.rearmEpoch;
    const foundBackend = session ? session.backend : nativeLiveGraphSession.backend;
    if (!session && foundBackend !== null && foundBackend !== backend) {
        throw new Error('Native NAM session was replaced');
    }
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
        current();
        assertDrainLifetime(
            backend,
            epoch,
            foundBackend,
            'Native NAM backend disposed or lifetime readback unavailable'
        );
        const position = await getEngineTransportPosition();
        current();
        assertDrainLifetime(backend, epoch, foundBackend, 'Native NAM backend disposed during drain');
        if (!position.running || position.engineId !== accepted.engineId) {
            throw new Error('Native NAM engine changed or stopped during drain');
        }
        if (!Number.isSafeInteger(position.batchesApplied) || position.batchesApplied < 0) {
            throw new Error('Native NAM observed an unsafe fence');
        }
        if (position.batchesApplied >= (accepted.admittedBatch ?? Infinity)) {
            if (
                !accepted.grinderModels?.every((expected) =>
                    position.grinderModels?.some((actual) => sameModel(actual, expected))
                )
            ) {
                throw new Error('Native NAM target/request was superseded or never installed');
            }
            return;
        }
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 16);
        });
    }
    throw new Error('Native NAM matching callback drain timed out');
}

/** A queued admission is only the beginning; completion belongs to the same live callback. */
export async function sendNativeGrinderNeuralPatch(input: Input): Promise<void> {
    if (input.kind === 'drain') {
        await drain(input.backend, input.result, () => {}, input.session);
        return;
    }
    const backend = nativeLiveGraphSession.backend;
    if (!backend) {
        throw new Error('Native NAM session is unavailable');
    }
    const epoch = nativeLiveGraphSession.rearmEpoch;
    const target = trackStore.value?.tracks
        .find((track) => track.id === input.trackId)
        ?.devices.find((device) => device.id === input.deviceId);
    if (!target || target.type.toLowerCase() !== 'grinder') {
        throw new Error('Native NAM device is unavailable');
    }
    const latest = latestByBackend.get(backend) ?? new Map<string, object>();
    latestByBackend.set(backend, latest);
    if (!latest.has(input.deviceId) && latest.size >= 16) {
        throw new Error('Native NAM pending target limit');
    }
    const token = {};
    latest.set(input.deviceId, token);
    let removed = false;
    // Project replacement/removal must not revive a queued same-id device.
    const unsubscribe = trackStore.subscribe((state) => {
        if (
            !state?.tracks.some(
                (track) => track.id === input.trackId && track.devices.some((device) => device === target)
            )
        ) {
            removed = true;
        }
    });
    const current = () => {
        if (
            removed ||
            latest.get(input.deviceId) !== token ||
            nativeLiveGraphSession.backend !== backend ||
            nativeLiveGraphSession.rearmEpoch !== epoch
        ) {
            throw new Error('Native NAM request/device/session was superseded');
        }
    };
    const requestId = crypto.randomUUID();
    try {
        const result = await queueOnNativeLiveGraphSession(async () => {
            current();
            return backend.apply({
                schemaVersion: 1,
                commands: [
                    {
                        kind: 'set-grinder-model',
                        target: { trackId: input.trackId, deviceId: input.deviceId },
                        requestId,
                        modelJson: input.modelJson,
                        values: input.values,
                    },
                ],
            });
        });
        current();
        const accepted = admitted(result);
        if (
            accepted.grinderModels?.length !== 1 ||
            accepted.grinderModels[0]?.requestId !== requestId ||
            accepted.grinderModels[0]?.deviceId !== input.deviceId ||
            accepted.grinderModels[0]?.trackId !== input.trackId
        ) {
            throw new Error('Native NAM admission belongs to another request');
        }
        await drain(backend, accepted, current);
    } finally {
        unsubscribe();
        if (latest.get(input.deviceId) === token) {
            latest.delete(input.deviceId);
        }
    }
}

import { createStore } from '#/infra/store/createStore';

export type CrumbsRecordingPhase =
    'idle' | 'preparing' | 'waiting' | 'recording' | 'finishing' | 'completed' | 'cancelled' | 'failed';

/** Native runtime readout only: never persisted, dirtied, or entered into undo. */
export type CrumbsRecordingSnapshot = {
    instance_id: string;
    instance_incarnation: string;
    take_id: string;
    revision: string;
    phase: CrumbsRecordingPhase;
    first_input: { position_frames: string; frames: number } | null;
    failure: string | null;
};

export type AcceptedCrumbsTake = { take_id: string };
export type CrumbsRecordingRequest = {
    acceptance: Promise<AcceptedCrumbsTake | null>;
    takeId: string | null;
    stopRequested: boolean;
    stopSent: boolean;
    stopPromise: Promise<void> | null;
    disposed: boolean;
};
export type CrumbsRecordingOwner = {
    active: boolean;
    latest: CrumbsRecordingSnapshot | null;
    buffered: CrumbsRecordingSnapshot | null;
    request: CrumbsRecordingRequest | null;
    setup: Promise<void>;
    reconciling: Promise<void> | null;
    unlisten: (() => void) | null;
};

type RecordingReadout = {
    snapshot: CrumbsRecordingSnapshot | null;
    phase: CrumbsRecordingPhase;
    failure: string | null;
};

export const crumbsRecordingStore = createStore<Record<string, RecordingReadout>>({ initialData: {} });
// An owner object is the renderer generation fence; removing/recreating an id
// never grants an old event handler or admission continuation its successor.
export const crumbsRecordingOwners = new Map<string, CrumbsRecordingOwner>();

function isDecimalU64(value: unknown): value is string {
    return typeof value === 'string' && /^(0|[1-9][0-9]*)$/u.test(value) && BigInt(value) <= 18446744073709551615n;
}

/** Validate the shared native snapshot/event contract without narrowing u64s. */
export function decodeCrumbsRecordingSnapshot(value: unknown): CrumbsRecordingSnapshot {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError('Invalid Crumbs recording snapshot');
    }
    const candidate = value as Record<string, unknown>;
    const phases: readonly unknown[] = [
        'idle',
        'preparing',
        'waiting',
        'recording',
        'finishing',
        'completed',
        'cancelled',
        'failed',
    ];
    if (
        typeof candidate.instance_id !== 'string' ||
        candidate.instance_id.length === 0 ||
        !isDecimalU64(candidate.instance_incarnation) ||
        !isDecimalU64(candidate.take_id) ||
        !isDecimalU64(candidate.revision) ||
        !phases.includes(candidate.phase) ||
        (candidate.failure !== null && typeof candidate.failure !== 'string')
    ) {
        throw new TypeError('Invalid Crumbs recording snapshot');
    }
    let firstInput: CrumbsRecordingSnapshot['first_input'] = null;
    if (candidate.first_input !== null) {
        if (typeof candidate.first_input !== 'object' || candidate.first_input === null) {
            throw new TypeError('Invalid Crumbs first-input witness');
        }
        const input = candidate.first_input as Record<string, unknown>;
        if (
            !isDecimalU64(input.position_frames) ||
            typeof input.frames !== 'number' ||
            !Number.isSafeInteger(input.frames) ||
            input.frames <= 0
        ) {
            throw new TypeError('Invalid Crumbs first-input witness');
        }
        firstInput = { position_frames: input.position_frames, frames: input.frames };
    }
    if ((candidate.phase === 'waiting' || candidate.phase === 'recording') && firstInput === null) {
        throw new TypeError('Crumbs readiness requires a first-input witness');
    }
    return {
        instance_id: candidate.instance_id,
        instance_incarnation: candidate.instance_incarnation,
        take_id: candidate.take_id,
        revision: candidate.revision,
        phase: candidate.phase as CrumbsRecordingPhase,
        first_input: firstInput,
        failure: candidate.failure,
    };
}

export function isCrumbsRecordingTerminal(phase: CrumbsRecordingPhase): boolean {
    return phase === 'idle' || phase === 'completed' || phase === 'cancelled' || phase === 'failed';
}

export function createCrumbsRecordingRequest(acceptance: Promise<AcceptedCrumbsTake | null>): CrumbsRecordingRequest {
    return { acceptance, takeId: null, stopRequested: false, stopSent: false, stopPromise: null, disposed: false };
}

export function setCrumbsRecordingPhase(
    instanceId: string,
    phase: CrumbsRecordingPhase,
    failure: string | null = null
): void {
    crumbsRecordingStore.update((current) => ({
        ...current,
        [instanceId]: { snapshot: current?.[instanceId]?.snapshot ?? null, phase, failure },
    }));
}

export function refreshCrumbsRecordingReadout(instanceId: string, owner: CrumbsRecordingOwner): void {
    if (!owner.active || crumbsRecordingOwners.get(instanceId) !== owner) {
        return;
    }
    const snapshot = owner.latest;
    const request = owner.request;
    let phase = snapshot?.phase ?? 'idle';
    if (request) {
        if (request.takeId === null || snapshot?.take_id !== request.takeId) {
            phase = request.stopRequested ? 'finishing' : 'preparing';
        } else if (isCrumbsRecordingTerminal(snapshot.phase)) {
            owner.request = null;
        } else if (request.stopRequested) {
            phase = 'finishing';
        }
    }
    crumbsRecordingStore.update((current) => ({
        ...current,
        [instanceId]: { snapshot, phase, failure: snapshot?.failure ?? null },
    }));
}

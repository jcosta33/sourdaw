import { getEngineTransportPosition } from '../../repositories/engineTransport/getEngineTransportPosition';
import { readNativeEngineIncarnation } from '../../repositories/nativeEngineIncarnation';

import { nativeLiveGraphSessionOffered } from './nativeLiveGraphSessionOffered';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { reportAttachedPlugins } from './reportAttachedPlugins';

const READINESS_TIMEOUT_MS = 3_000;
const POSITION_POLL_MS = 8;

function cancelled(): Error {
    return new Error('The audition listening request changed.');
}

function bounded<T>(work: () => Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
    if (signal.aborted) {
        return Promise.reject(cancelled());
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (complete: () => void) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            complete();
        };
        const abort = () => finish(() => reject(cancelled()));
        const timer = setTimeout(
            () => finish(() => reject(new Error('Native audition listening readiness timed out.'))),
            timeoutMs
        );
        signal.addEventListener('abort', abort, { once: true });
        void Promise.resolve()
            .then(work)
            .then(
                (value) => finish(() => resolve(value)),
                (error: unknown) => finish(() => reject(error))
            );
    });
}

// Only a renderer-observed session/base transition may be followed on release.
// A bad native witness or a failed command is never this condition.
class SessionTransition extends Error {}

type MonitoringInput = {
    signal: AbortSignal;
    isCurrent: () => boolean;
    /** Release only: open Web output in the same turn as its fresh native witness. */
    restoreWebProgramme?: () => void;
};
type MonitoringScope = {
    input: MonitoringInput;
    deadline: number;
    current: () => boolean;
    assertCurrent: () => void;
    queued: <T>(work: () => Promise<T>) => Promise<T>;
};

function createScope(input: MonitoringInput): MonitoringScope {
    const deadline = performance.now() + READINESS_TIMEOUT_MS;
    const current = () => !input.signal.aborted && input.isCurrent();
    const assertCurrent = () => {
        if (!current()) throw cancelled();
        if (performance.now() >= deadline) throw new Error('Native audition listening readiness timed out.');
    };
    const queued = <T>(work: () => Promise<T>) =>
        bounded(
            () =>
                queueOnNativeLiveGraphSession(async () => {
                    assertCurrent();
                    return work();
                }),
            input.signal,
            Math.max(1, deadline - performance.now())
        );
    return { input, deadline, current, assertCurrent, queued };
}

function admitOutputGate(scope: MonitoringScope) {
    return scope.queued(async () => {
        const session = nativeLiveGraphSession;
        const backend = session.backend;
        const epoch = session.auditionEpoch;
        const owner = session.auditionOwner;
        const baseShadowed = session.monitorShadowed;
        const unchanged = () =>
            scope.current() &&
            session.backend === backend &&
            session.auditionEpoch === epoch &&
            session.auditionOwner === owner &&
            session.monitorShadowed === baseShadowed;
        const assertUnchanged = () => {
            scope.assertCurrent();
            if (!unchanged()) throw new SessionTransition();
        };
        if (backend === null) {
            if (session.startsPending !== 0) throw new SessionTransition();
            if (session.orphanedBackend !== null)
                throw new Error('A native programme has not settled into an owned listening session.');
            const position = await getEngineTransportPosition();
            assertUnchanged();
            if (session.startsPending !== 0) throw new SessionTransition();
            if (
                session.orphanedBackend !== null ||
                position.engineIncarnation !== null ||
                position.running ||
                position.playing
            )
                throw new Error('The native engine did not witness an empty output slot.');
            scope.input.restoreWebProgramme?.();
            return { unchanged, assertUnchanged, incarnation: null, fence: 0 };
        }
        const shadowed = baseShadowed || owner !== null;
        const result = await backend.apply({ schemaVersion: 1, commands: [{ kind: 'set-monitor-shadow', shadowed }] });
        reportAttachedPlugins(result);
        // A native refusal remains a failure even if a new gesture arrived
        // while it was in flight. Only a successful old fence can be replaced.
        if (result.application !== 'applied')
            throw new Error('The native engine did not apply its audition output gate.');
        const incarnation = readNativeEngineIncarnation(result.engineIncarnation);
        const fence = result.admittedBatch;
        if (incarnation === undefined || fence === undefined || !Number.isSafeInteger(fence) || fence < 1)
            throw new Error('The native output gate has no exact engine identity and admitted fence.');
        assertUnchanged();
        return { unchanged, assertUnchanged, incarnation, fence };
    });
}

type AdmittedGate = Awaited<ReturnType<typeof admitOutputGate>>;

async function witnessOutputGate(scope: MonitoringScope, admitted: AdmittedGate) {
    if (admitted.incarnation === null) return { isCurrent: admitted.unchanged };
    for (;;) {
        const witnessed = await scope.queued(async () => {
            admitted.assertUnchanged();
            const position = await getEngineTransportPosition();
            admitted.assertUnchanged();
            if (position.engineIncarnation !== admitted.incarnation || !position.running)
                throw new Error('The native engine changed or stopped before its output gate was witnessed.');
            if (!Number.isSafeInteger(position.batchesApplied) || position.batchesApplied < 0)
                throw new Error('The native output gate returned an inexact fence counter.');
            if (position.batchesApplied < admitted.fence) return false;
            const session = nativeLiveGraphSession;
            session.auditionOutputSuppressed = session.auditionOwner !== null;
            session.audibleCarrier =
                session.programmeCarrier && !session.monitorShadowed && !session.auditionOutputSuppressed;
            // A later gesture may run as soon as this turn ends. Commit the
            // witnessed Web gate here, so an old promise cannot open over it.
            scope.input.restoreWebProgramme?.();
            return true;
        });
        if (witnessed) return { isCurrent: admitted.unchanged };
        await bounded(
            () => new Promise<void>((resolve) => setTimeout(resolve, POSITION_POLL_MS)),
            scope.input.signal,
            Math.max(1, scope.deadline - performance.now())
        );
    }
}

/** Internal operation: prove the latest output target on the actual native engine. */
export async function reconcileNativeAuditionMonitoring(input: MonitoringInput): Promise<{ isCurrent: () => boolean }> {
    const scope = createScope(input);
    scope.assertCurrent();
    if (!nativeLiveGraphSessionOffered()) {
        input.restoreWebProgramme?.();
        return { isCurrent: scope.current };
    }
    for (;;) {
        try {
            return await witnessOutputGate(scope, await admitOutputGate(scope));
        } catch (error) {
            if (
                !(error instanceof SessionTransition) ||
                input.restoreWebProgramme === undefined ||
                nativeLiveGraphSession.auditionOwner !== null
            )
                throw error;
            // Stop may overlap a genuine newer native admission. Follow its
            // queued installation, using the ORIGINAL absolute deadline, then
            // obtain a new identity/fence. Never replay stale base flags.
            scope.assertCurrent();
        }
    }
}

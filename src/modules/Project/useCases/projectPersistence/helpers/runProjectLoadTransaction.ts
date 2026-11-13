import { cancelPendingAudioBufferImport } from '#/modules/AudioEngine/useCases';
import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { projectTransitionEpoch, projectTransitionState } from '../../../stores/projectTransitionEpoch';
import { projectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';
import { whenProjectIdentityTransitionDependenciesConfigured } from '../whenProjectIdentityTransitionDependenciesConfigured';

let nextProjectTransitionId = 0;

// A subordinate boot restore may replace another boot restore, but never a
// user-initiated project identity that has already activated.
let activeProjectTransitionHasExplicitAuthority = false;
// Count of transitions that have committed to preparing and not yet settled
// (activated, or failed/superseded during prepare). A yielding boot restore
// stands down while this is non-zero. Unlike a `latestPrepared > active`
// comparison, the counter self-heals: a prepare that throws or loses the race
// decrements it, so a failed transition never strands the machinery in a
// permanent "mid-flight" state.
let preparingProjectTransitionCount = 0;
let runtimeTransitionTail = Promise.resolve();
const projectTransitionRevocations = new Map<number, AbortController>();

type ProjectTransitionTicketState = {
    activated: boolean;
    abandoned: boolean;
    prepared: boolean;
    countedAsPreparing: boolean;
    preparation: Promise<boolean> | null;
};

function revokeProjectTransition(transitionId: number, revocation: AbortController): void {
    projectTransitionRevocations.delete(transitionId);
    revocation.abort();
}

function claimProjectTransition(transitionId: number, revocation: AbortController): void {
    for (const [otherTransitionId, controller] of projectTransitionRevocations) {
        if (otherTransitionId !== transitionId) {
            controller.abort();
            projectTransitionRevocations.delete(otherTransitionId);
        }
    }
    projectTransitionRevocations.set(transitionId, revocation);
}

function releasePreparingCount(ticket: ProjectTransitionTicketState): void {
    if (ticket.countedAsPreparing) {
        ticket.countedAsPreparing = false;
        preparingProjectTransitionCount -= 1;
    }
}

function settleEditReplacement(transitionId: number): void {
    if (projectTransitionState.pendingEditReplacement === transitionId) {
        projectTransitionState.pendingEditReplacement = null;
    }
}

export type ProjectLoadTransaction = {
    prepare: () => Promise<boolean>;
    activate: () => boolean;
    abandon: () => void;
    canActivate: () => boolean;
    isCurrent: () => boolean;
    signal: AbortSignal;
};

export const projectLoadEpoch = {
    async acquireRuntimeTransition(): Promise<() => void> {
        const predecessor = runtimeTransitionTail;
        const next = Promise.withResolvers<void>();
        runtimeTransitionTail = next.promise;
        await predecessor;
        return next.resolve;
    },
    get current(): number {
        return projectTransitionEpoch.current;
    },
    isCurrent(epoch: number): boolean {
        return projectTransitionEpoch.isCurrent(epoch);
    },
};

type RunProjectLoadTransactionInput = {
    // Marks a subordinate startup-restore transition (the boot `loadProject`)
    // that must NEVER supersede a user-initiated transition that is mid-flight.
    //
    // Ordering is by creation id: the last-created transition wins. That is the
    // right rule between two explicit user actions (click "New" then "Open" and
    // "Open" should win), and between two boot loads (a newer restore supersedes
    // an older one still in flight). But it inverts for the boot restore versus
    // a user's launch choice, because the boot restore is created LATE — it is
    // gated behind `await initializeAudioEngine()` in useAppInitialization. If
    // the user clicks a template on the LaunchScreen before that slow init
    // resolves, the template transition is created first (lower id) and starts
    // preparing, yet the boot transition is created second (higher id) and would
    // supersede the user's explicit choice, dropping them on an empty "Untitled
    // Project". A yielding transition stands down while any other transition is
    // mid-flight (committed to preparing, not yet settled), so the user's choice
    // wins; once every transition has settled the normal last-wins rule applies,
    // which keeps boot-vs-boot supersession intact.
    yieldToInFlight?: boolean;
};

type RunProjectLoadTransactionOutput = ProjectLoadTransaction;

async function prepareProjectTransition(
    transitionId: number,
    yieldToInFlight: boolean,
    ticket: ProjectTransitionTicketState,
    revocation: AbortController
): Promise<boolean> {
    if (ticket.abandoned) {
        return false;
    }
    if (yieldToInFlight && (preparingProjectTransitionCount > 0 || activeProjectTransitionHasExplicitAuthority)) {
        revokeProjectTransition(transitionId, revocation);
        return false;
    }
    if (transitionId < projectTransitionState.latestPrepared) {
        revokeProjectTransition(transitionId, revocation);
        return false;
    }
    projectTransitionState.latestPrepared = transitionId;
    projectTransitionState.editRevocation += 1;
    projectTransitionState.pendingEditReplacement = transitionId;
    claimProjectTransition(transitionId, revocation);
    ticket.countedAsPreparing = true;
    preparingProjectTransitionCount += 1;
    try {
        await whenProjectIdentityTransitionDependenciesConfigured();
        if (ticket.abandoned) {
            releasePreparingCount(ticket);
            settleEditReplacement(transitionId);
            return false;
        }
        resetActionReplayAuthority();
        await projectIdentityTransitionDependencies.leaveCollaborationSession();
        if (ticket.abandoned || transitionId !== projectTransitionState.latestPrepared) {
            releasePreparingCount(ticket);
            settleEditReplacement(transitionId);
            revokeProjectTransition(transitionId, revocation);
            return false;
        }
        ticket.prepared = true;
        return true;
    } catch (error) {
        releasePreparingCount(ticket);
        settleEditReplacement(transitionId);
        revokeProjectTransition(transitionId, revocation);
        throw error;
    }
}

export function runProjectLoadTransaction({
    yieldToInFlight = false,
}: RunProjectLoadTransactionInput = {}): RunProjectLoadTransactionOutput {
    const transitionId = ++nextProjectTransitionId;
    const revocation = new AbortController();
    const ticket: ProjectTransitionTicketState = {
        activated: false,
        abandoned: false,
        prepared: false,
        countedAsPreparing: false,
        preparation: null,
    };

    return {
        prepare: () => {
            ticket.preparation ??= prepareProjectTransition(transitionId, yieldToInFlight, ticket, revocation);
            return ticket.preparation;
        },
        activate: () => {
            // Activation is the terminal event for a prepared transition, whether
            // it wins or is superseded: settle it out of the in-flight count.
            if (ticket.activated) {
                return projectTransitionEpoch.isCurrent(transitionId);
            }
            if (!ticket.prepared || ticket.abandoned) {
                return false;
            }
            releasePreparingCount(ticket);
            if (
                revocation.signal.aborted ||
                transitionId < projectTransitionState.active ||
                transitionId !== projectTransitionState.latestPrepared
            ) {
                settleEditReplacement(transitionId);
                revokeProjectTransition(transitionId, revocation);
                return false;
            }
            projectTransitionState.active = transitionId;
            ticket.activated = true;
            settleEditReplacement(transitionId);

            activeProjectTransitionHasExplicitAuthority = !yieldToInFlight;
            cancelPendingAudioBufferImport();
            return true;
        },
        abandon: () => {
            if (ticket.activated || ticket.abandoned) {
                return;
            }
            ticket.abandoned = true;
            revokeProjectTransition(transitionId, revocation);
            // A held preparation can still resume after its I/O settles. Its
            // pending owner stays closed until that continuation observes abandonment.
            if (ticket.prepared) {
                releasePreparingCount(ticket);
                settleEditReplacement(transitionId);
            }
        },
        canActivate: () =>
            !ticket.abandoned &&
            transitionId >= projectTransitionState.active &&
            transitionId >= projectTransitionState.latestPrepared,
        isCurrent: () =>
            !revocation.signal.aborted && ticket.activated && projectTransitionEpoch.isCurrent(transitionId),
        signal: revocation.signal,
    };
}

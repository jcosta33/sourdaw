import { cancelPendingAudioBufferImport } from '#/modules/AudioEngine/useCases';
import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { projectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';

let nextProjectTransitionId = 0;
let activeProjectTransitionId = 0;
let latestPreparedProjectTransitionId = 0;

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

export type ProjectLoadTransaction = {
    prepare: () => Promise<boolean>;
    activate: () => boolean;
    canActivate: () => boolean;
    isCurrent: () => boolean;
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
        return activeProjectTransitionId;
    },
    isCurrent(epoch: number): boolean {
        return epoch > 0 && epoch === activeProjectTransitionId && epoch === latestPreparedProjectTransitionId;
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

export function runProjectLoadTransaction({
    yieldToInFlight = false,
}: RunProjectLoadTransactionInput = {}): RunProjectLoadTransactionOutput {
    const transitionId = ++nextProjectTransitionId;
    let activated = false;
    let prepared = false;
    let countedAsPreparing = false;
    let preparation: Promise<boolean> | null = null;

    // Settle this transition exactly once: drop it from the in-flight count. Safe
    // to call repeatedly and before prepare ever ran.
    function releasePreparingCount(): void {
        if (countedAsPreparing) {
            countedAsPreparing = false;
            preparingProjectTransitionCount -= 1;
        }
    }

    return {
        prepare: () => {
            preparation ??= (async () => {
                // A yielding (boot restore) transition defers to any explicit
                // transition that is either preparing or already authoritative.
                // Standing down before any side effect leaves that user choice
                // untouched so startup restoration cannot replace it.
                if (
                    yieldToInFlight &&
                    (preparingProjectTransitionCount > 0 || activeProjectTransitionHasExplicitAuthority)
                ) {
                    return false;
                }
                if (transitionId < latestPreparedProjectTransitionId) {
                    return false;
                }
                // Commit to preparing: claim the latest-prepared slot and join the
                // in-flight count. Everything from here — the replay-authority
                // reset and the collaboration teardown — runs inside one guarded
                // region so that a throw anywhere (not just the awaited teardown)
                // releases the count. The idempotent guard makes the release safe
                // even though the success path deliberately keeps this transition
                // counted until it activates.
                latestPreparedProjectTransitionId = transitionId;
                countedAsPreparing = true;
                preparingProjectTransitionCount += 1;
                try {
                    resetActionReplayAuthority();
                    await projectIdentityTransitionDependencies.leaveCollaborationSession();
                    if (transitionId !== latestPreparedProjectTransitionId) {
                        releasePreparingCount();
                        return false;
                    }
                    prepared = true;
                    return true;
                } catch (error) {
                    releasePreparingCount();
                    throw error;
                }
            })();
            return preparation;
        },
        activate: () => {
            // Activation is the terminal event for a prepared transition, whether
            // it wins or is superseded: settle it out of the in-flight count.
            releasePreparingCount();
            if (activated) {
                return transitionId === activeProjectTransitionId && transitionId === latestPreparedProjectTransitionId;
            }
            if (
                !prepared ||
                transitionId < activeProjectTransitionId ||
                transitionId !== latestPreparedProjectTransitionId
            ) {
                return false;
            }
            activeProjectTransitionId = transitionId;
            activated = true;

            activeProjectTransitionHasExplicitAuthority = !yieldToInFlight;
            cancelPendingAudioBufferImport();
            return true;
        },
        canActivate: () =>
            transitionId >= activeProjectTransitionId && transitionId >= latestPreparedProjectTransitionId,
        isCurrent: () =>
            activated &&
            transitionId === activeProjectTransitionId &&
            transitionId === latestPreparedProjectTransitionId,
    };
}

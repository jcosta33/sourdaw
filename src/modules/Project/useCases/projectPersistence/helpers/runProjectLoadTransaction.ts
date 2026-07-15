import { cancelPendingAudioBufferImport } from '#/modules/AudioEngine/useCases';
import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { projectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';

let nextProjectTransitionId = 0;
let activeProjectTransitionId = 0;
let latestPreparedProjectTransitionId = 0;

export type ProjectLoadTransaction = {
    prepare: () => Promise<boolean>;
    activate: () => boolean;
    canActivate: () => boolean;
    isCurrent: () => boolean;
};

export const projectLoadEpoch = {
    get current(): number {
        return activeProjectTransitionId;
    },
};

type RunProjectLoadTransactionOutput = ProjectLoadTransaction;

export function runProjectLoadTransaction(): RunProjectLoadTransactionOutput {
    const transitionId = ++nextProjectTransitionId;
    let activated = false;
    let prepared = false;
    let preparation: Promise<boolean> | null = null;

    return {
        prepare: () => {
            preparation ??= (async () => {
                if (transitionId < latestPreparedProjectTransitionId) {
                    return false;
                }
                latestPreparedProjectTransitionId = transitionId;
                resetActionReplayAuthority();
                await projectIdentityTransitionDependencies.leaveCollaborationSession();
                if (transitionId !== latestPreparedProjectTransitionId) {
                    return false;
                }
                prepared = true;
                return true;
            })();
            return preparation;
        },
        activate: () => {
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

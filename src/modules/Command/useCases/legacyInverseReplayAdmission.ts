import { type AppAction } from '#/utils/handlerContract';

/**
 * The admission a recorded inverse list passes before undo, redo or a group
 * revert replays it when it holds a keyless `trimClipStart` inverse: the
 * reason the legacy trim's coordinates cannot be proved, or `null` when the
 * replay may run.
 */
type LegacyInverseReplayAdmission = {
    getLegacyTrimInverseReplayFailure: (actions: readonly AppAction[]) => string | null;
};

let registeredAdmission: LegacyInverseReplayAdmission | null = null;

/**
 * Whether a legacy trim's recorded coordinates still hold is clip and trim
 * knowledge Arrangement owns, and Command, the shared execution kernel, may
 * not import Arrangement, so the composition root
 * (`#/app/registerKernelPorts`) fills this once at boot, before any undo can
 * replay an inverse.
 */
export const legacyInverseReplayAdmission = {
    /**
     * Registering the identical admission again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(admission: LegacyInverseReplayAdmission): void {
        if (registeredAdmission === null) {
            registeredAdmission = admission;
            return;
        }
        if (registeredAdmission.getLegacyTrimInverseReplayFailure !== admission.getLegacyTrimInverseReplayFailure) {
            throw new Error('legacyInverseReplayAdmission.configure: the admission differs from the registered one');
        }
    },
    /**
     * The registered admission. Reading before registration throws rather than
     * admitting the replay: a legacy trim inverse would then restore
     * coordinates nothing proved still hold.
     */
    read(caller: string): LegacyInverseReplayAdmission {
        if (registeredAdmission === null) {
            throw new Error(
                `${caller}: the legacy inverse replay admission is not registered; call registerKernelPorts() from #/app/registerKernelPorts (bootstrap does this)`
            );
        }
        return registeredAdmission;
    },
};

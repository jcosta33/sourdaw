import { isCrumbsNativeAvailable } from '../../repositories/crumbsBridge/isCrumbsNativeAvailable';

import type { CrumbsNativeLifecycle } from '../../stores/crumbsNativeLifecycleStore';

export type CrumbsEngineWitnesses = Readonly<{
    /** The engine reports it holds this device's instance (`crumbsEngineAttachmentStore`). */
    attachedNatively: boolean;
    /** This device has instance state to write to (`crumbsStore`). */
    hasInstanceState: boolean;
    /** How far this device's native instance got (`crumbsNativeLifecycleStore`). */
    nativeLifecycle: CrumbsNativeLifecycle | undefined;
}>;

/**
 * Whether a write from the panel reaches a sampler: `true` when one does,
 * `false` when there is none behind this device, and `null` while that is not
 * yet decided.
 *
 * The attachment mirror settles it on its own: the engine is rendering this
 * instance. Past that, the answer comes from which carrier is in question.
 *
 * On a native build it is the create's own outcome and nothing else. A `bound`
 * instance takes the write even before a batch attaches it — a dormant instance
 * parks parameters and `attach_dormant_crumbs` hands it over later — so absence
 * from the mirror is not a failure. A `failed` one is: the create was refused
 * and its instance state rolled back, so the device has no sampler at all, and
 * saying so is the point of this reading. Instance state cannot stand in for
 * it, because `ensureCrumbsInstanceFromProject` seeds an entry on every panel
 * mount whether or not an instance was ever created.
 *
 * On the browser build no native instance is in question: the worklet node on
 * the strip takes the write, and the store entry the panel ensures on mount is
 * what says the node's state exists. `null` there is the first frames before
 * that entry lands.
 */
export function readCrumbsEngineReadiness(witnesses: CrumbsEngineWitnesses): boolean | null {
    if (witnesses.attachedNatively) {
        return true;
    }
    if (!isCrumbsNativeAvailable()) {
        return witnesses.hasInstanceState ? true : null;
    }
    if (witnesses.nativeLifecycle === 'bound') {
        return true;
    }
    return witnesses.nativeLifecycle === 'failed' ? false : null;
}

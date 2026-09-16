import { isCrumbsNativeAvailable } from '../../repositories/crumbsBridge/isCrumbsNativeAvailable';

export type CrumbsEngineWitnesses = Readonly<{
    /** The engine reports it holds this device's instance (`crumbsEngineAttachmentStore`). */
    attachedNatively: boolean;
    /** This device has instance state to write to (`crumbsStore`). */
    hasInstanceState: boolean;
}>;

/**
 * Whether a write from the panel reaches a sampler: `true` when one does,
 * `false` when the engine that owns this device's instance has none, and `null`
 * while that is not yet decided.
 *
 * Two witnesses, either of which is sufficient. The attachment mirror is the
 * stronger: the engine is rendering this instance. Instance state is the weaker
 * and still sufficient one — on the browser build the worklet node takes the
 * write, and on a native build a created-but-dormant instance parks it until
 * the next graph batch attaches it (`attach_dormant_crumbs`), so reporting the
 * backend unavailable for a dormant instance would name a failure that is not
 * one.
 *
 * The undecided case is the browser build's first frames, where nothing native
 * is in question and the store entry the panel ensures on mount has not landed
 * yet. On the desktop build that entry is already there when the panel opens —
 * `syncCrumbsNativeInstances` ensures it the moment the device appears on the
 * project — so a missing one is a real failure to create the instance and the
 * panel says so.
 */
export function readCrumbsEngineReadiness(witnesses: CrumbsEngineWitnesses): boolean | null {
    if (witnesses.attachedNatively || witnesses.hasInstanceState) {
        return true;
    }
    return isCrumbsNativeAvailable() ? false : null;
}

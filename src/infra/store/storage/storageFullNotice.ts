import { notifyUser } from '#/utils/Notification/notifyUser';

const STORAGE_FULL_MESSAGE = 'Storage is full — your changes will not be saved. Free up space and try again.';

/**
 * Whether the notice has actually been emitted. Set only after `notifyUser`
 * has run — never on a deferral. A boot refusal that recorded the notice
 * without delivering it would burn this flag and leave every later refusal, on
 * a working bus, permanently silent.
 */
let hasReportedStorageFull = false;

/** A refusal happened before the composition root was ready. */
let noticeDeferred = false;

/**
 * Set by `flushDeferredStorageNotice`, which the composition root calls once the
 * notification bus is registered.
 *
 * This gate exists because `notifyUser` is DI-injected and `inject` caches the
 * resolved closure on first call. When the `NotificationEventBus` token is not
 * registered, resolution does not throw — `resolveInjectedDependency` falls
 * through to the raw dependency, which is the abstract class — so the factory
 * builds a closure holding a class with no `emit` and caches it for the life of
 * the page. Every one of the ~140 `notifyUser` call sites would then throw
 * `TypeError: eventBus.emit is not a function` forever.
 *
 * A store's constructor seed is a live pre-bootstrap caller: on a sealed origin
 * it is the first refused write of the boot, during ES module evaluation. So
 * nothing here may resolve DI until the root says it is safe.
 */
let compositionRootReady = false;

/**
 * Tell the user, once per session, that the origin will not accept writes.
 *
 * The condition is the origin, not the key: once the quota is gone every
 * subsequent write fails too, and a notification per refused write on paths
 * that fire on interaction would be its own defect. Per-key detail stays in the
 * log.
 */
export function reportStorageFullOnce(): void {
    if (hasReportedStorageFull) {
        return;
    }

    if (!compositionRootReady) {
        noticeDeferred = true;
        return;
    }

    hasReportedStorageFull = true;
    notifyUser(STORAGE_FULL_MESSAGE, 'error');
}

/**
 * Open the gate, and deliver a notice that a pre-bootstrap refusal had to hold.
 *
 * Called by `bootstrap.ts` immediately after `setNotificationEventBus`. Before
 * this runs, no code path here touches the DI container.
 */
export function flushDeferredStorageNotice(): void {
    compositionRootReady = true;

    if (hasReportedStorageFull || !noticeDeferred) {
        return;
    }

    noticeDeferred = false;
    hasReportedStorageFull = true;
    notifyUser(STORAGE_FULL_MESSAGE, 'error');
}

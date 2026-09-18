import { markEveryCrumbsInstanceDetached } from '../../stores/crumbsEngineAttachmentStore';

/**
 * Give up every recorded Crumbs attachment, because the engine that held them
 * is gone.
 *
 * Whole-mirror rather than per-instance, because an engine retirement and a
 * graph rebuild name no instance: the native side puts every Crumbs slot back
 * to dormant with the engine that held it (`crumbs::detach_from_retired_engine`),
 * so anything still claiming an engine afterwards claims a slot that no longer
 * exists — and a topology naming it is refused whole.
 *
 * Nothing restores the mirror directly. The next graph batch re-attaches
 * whatever instances are still there and reports them, and that report is what
 * fills it again.
 */
export function retractEveryCrumbsEngineAttachment(): void {
    markEveryCrumbsInstanceDetached();
}

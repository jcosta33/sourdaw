import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

/**
 * Hand one block of the monitored input bus to the native crumbs record feed.
 *
 * Raw bytes cross on the desktop bridge's binary channel, exactly as
 * `process_plugin_audio` carries plugin audio: the payload is interleaved
 * little-endian f32 and never JSON. The Rust side pushes it into every
 * registered crumbs bridge, so there is no instance key on this call.
 */
export async function feedCrumbsRecordInput(audioBytes: Uint8Array): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await desktopInvoke('feed_crumbs_record_input', { audioBytes });
}

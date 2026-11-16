import { desktopInvoke } from '#/utils/desktopBridge';

/**
 * `cancel_graph_offline`: stop the render started under `renderId` at its next
 * block. The render then rejects with an error starting
 * `offline-render-cancelled`, and every plugin instance it built is released.
 * A cancel that reaches the native side before its render is kept and still
 * cancels it; one for a finished or unknown id does nothing.
 */
export async function cancelNativeGraphOfflineRender(renderId: string): Promise<void> {
    await desktopInvoke('cancel_graph_offline', { renderId });
}

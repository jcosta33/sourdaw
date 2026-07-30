let decodeContext: OfflineAudioContext | null = null;

/**
 * One shared decoding context, reused across sample loads.
 *
 * Same reason as Levain's: WKWebView caps how many audio contexts a page may
 * hold, and a per-sample context burns that budget. This one is only ever used
 * for `decodeAudioData` — it never renders.
 */
export function getCrumbsDecodeContext(): OfflineAudioContext {
    if (!decodeContext) {
        decodeContext = new OfflineAudioContext(2, 44_100, 44_100);
    }
    return decodeContext;
}

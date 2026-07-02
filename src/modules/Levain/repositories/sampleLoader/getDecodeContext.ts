// Use one shared decoding context to avoid WKWebView context limits.
let decodeContext: OfflineAudioContext | null = null;

export function getDecodeContext(): OfflineAudioContext {
    if (!decodeContext) {
        decodeContext = new OfflineAudioContext(2, 44_100, 44_100);
    }
    return decodeContext;
}

/**
 * PluginHost generation that already produced a capture-rejection warning.
 * Acceptance clears the entry; lifecycle invalidation supplies a different
 * token, so a new native instance gets its own warning episode.
 */
export const warnedExternalPluginCaptureRejections = new Map<string, object>();

/**
 * Last host state this peer accepted for one exact native-instance generation.
 *
 * The token comes from PluginHost and prevents a reused instance id from
 * inheriting the accepted state of the native object it replaced.
 */
export const capturedNativePluginStateCache = new Map<string, { stateChunk: string; authorityToken: object }>();

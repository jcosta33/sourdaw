/**
 * The plugin formats the host can load, as the native side names them on the
 * wire.
 *
 * One list, so "can this plugin be used" is answered in one place rather than by
 * a format comparison repeated at each call site. The native host is what
 * actually decides — a format it refuses is refused whatever this says — and
 * this list exists so the UI does not offer a plugin that a refusal is waiting
 * for. Formats the scan reports and the host cannot load are deliberately
 * absent.
 */
export const SUPPORTED_PLUGIN_FORMATS: readonly string[] = ['clap'];

/** Whether a scanned plugin's wire format is one the host can load. */
export function isSupportedPluginFormat(format: string): boolean {
    return SUPPORTED_PLUGIN_FORMATS.includes(format.toLowerCase());
}

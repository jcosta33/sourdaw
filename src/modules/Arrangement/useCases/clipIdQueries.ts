/**
 * TEMPORARY MIGRATION SHIM
 *
 * Exposes clip ID generation at the public use-case layer so cross-module
 * consumers (e.g. MIDI) do not need to reach into the private repositories/ folder.
 *
 * Remove after the global import convergence pass — replace with an explicit
 * use-case call or inline the counter logic where needed.
 */
export { getNextClipId } from '../repositories/clipIdCounter';

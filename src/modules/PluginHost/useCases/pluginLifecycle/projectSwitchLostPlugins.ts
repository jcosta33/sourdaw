/**
 * Plugins whose live state a pending project switch's teardown could not read.
 *
 * Runtime state owned by the one replacement holding the runtime transition:
 * reported only if that replacement is refused and the outgoing project comes
 * back without those edits, and forgotten silently once it switches, since the
 * user chose to leave the project they belonged to.
 */
export const projectSwitchLostPlugins = new Set<string>();

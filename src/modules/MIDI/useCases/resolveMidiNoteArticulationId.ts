import { articulationIdResolvers } from './articulationIdResolvers';

type ResolveMidiNoteArticulationIdInput = {
    deviceType: string;
    articulation: string | undefined;
};

/**
 * Canonical project-articulation projection for instruments with a per-note
 * runtime surface.
 *
 * The name-to-id table belongs to the instrument's module and reaches MIDI
 * through the resolver the composition root registers for its device type,
 * rather than being copied here. A second copy of it drifts silently: the ids
 * are a wire contract with the DSP engine, so a name added or renumbered in one
 * copy and not the other voices the wrong articulation with nothing to fail.
 */
export function resolveMidiNoteArticulationId({
    deviceType,
    articulation,
}: ResolveMidiNoteArticulationIdInput): number | null {
    if (articulation === undefined) {
        return null;
    }
    const resolveArticulationId = articulationIdResolvers.read('resolveMidiNoteArticulationId', deviceType);
    return resolveArticulationId === null ? null : resolveArticulationId(articulation);
}

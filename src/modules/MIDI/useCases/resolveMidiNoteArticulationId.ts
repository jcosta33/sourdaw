import { getLevainArticulationId } from '#/modules/Levain/useCases';

type ResolveMidiNoteArticulationIdInput = {
    deviceType: string;
    articulation: string | undefined;
};

/**
 * Canonical project-articulation projection for instruments with a per-note
 * runtime surface.
 *
 * The name-to-id table is Levain's and is read through its `useCases` barrel
 * rather than copied here. A second copy of it drifts silently: the ids are a
 * wire contract with the DSP engine, so a name added or renumbered in one copy
 * and not the other voices the wrong articulation with nothing to fail.
 */
export function resolveMidiNoteArticulationId({
    deviceType,
    articulation,
}: ResolveMidiNoteArticulationIdInput): number | null {
    if (deviceType !== 'levain' || articulation === undefined) {
        return null;
    }
    return getLevainArticulationId(articulation);
}

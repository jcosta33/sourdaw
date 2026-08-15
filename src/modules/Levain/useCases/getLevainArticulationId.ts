import { ARTICULATION_ID_BY_TYPE, isArticulationType } from '../models/LevainPatch';

/**
 * The engine id Levain voices an articulation name with, or `null` when Levain
 * has no articulation by that name.
 *
 * The ids are a wire contract with the DSP engine: they are what a project
 * stores against a note and what `note_on_with_channel_and_articulation`
 * receives, so they cannot be renumbered without changing what saved projects
 * sound like. `ARTICULATION_ID_BY_TYPE` is the one place they are written.
 *
 * The name arrives from a project file, where any printable string is accepted,
 * so it is checked with `Object.hasOwn` rather than indexed directly — an
 * unguarded index resolves an inherited name (`constructor`, `toString`,
 * `__proto__`) to a function, which is not nullish and would reach the worklet
 * port typed as a number.
 */
export function getLevainArticulationId(name: string): number | null {
    return isArticulationType(name) ? ARTICULATION_ID_BY_TYPE[name] : null;
}

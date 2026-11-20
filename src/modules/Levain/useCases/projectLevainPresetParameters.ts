import { type LevainPatch } from '../models/LevainPatch';

import { getLevainProjectParameterId } from './getLevainProjectParameterId';
import { projectLevainPatchToEngineParameters } from './projectLevainPatchToEngineParameters';

/** The numeric fields reset by an instrument choice. Articulation lives in the identity chunk. */
export function projectLevainPresetParameters(patch: LevainPatch): Record<string, number> {
    return Object.fromEntries(
        projectLevainPatchToEngineParameters(patch)
            .filter(({ name }) => name !== 'current_articulation')
            .map(({ name, value }) => [getLevainProjectParameterId(name), value])
    );
}

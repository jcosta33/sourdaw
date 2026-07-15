import { type FaustModule } from '../../models/FaustEngineTypes';

import { faustEngineState } from './faustEngineState';

export function getFaustModule(moduleId: string): FaustModule | null {
    return faustEngineState.modules.get(moduleId) ?? null;
}

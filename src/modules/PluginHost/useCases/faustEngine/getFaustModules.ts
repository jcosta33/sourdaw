import { type FaustModule } from '../../models/FaustEngineTypes';

import { faustEngineState } from './faustEngineState';

export function getFaustModules(): FaustModule[] {
    return [...faustEngineState.modules.values()];
}

import { faustEngineState } from './faustEngineState';

export function isFaustModule(moduleId: string): boolean {
    return faustEngineState.modules.has(moduleId);
}

import { compileFaustDSP } from './compileFaustDSP';
import { faustEngineState } from './faustEngineState';

export async function compileAllFaustModules(): Promise<number> {
    const results = await Promise.all([...faustEngineState.modules.keys()].map((id) => compileFaustDSP(id)));
    return results.filter(Boolean).length;
}

import { FaustMonoDspGenerator, FaustPolyDspGenerator } from '@grame/faustwasm';

import { logger } from '#/infra/logger/appLogger';

import { compileEffectFreeFaustPolyDsp } from './compileEffectFreeFaustPolyDsp';
import { getFaustCompiler } from './compilerEngine';
import { faustEngineState } from './faustEngineState';
import { getFaustErrorMessage } from './getFaustErrorMessage';

export async function compileFaustDSP(moduleId: string): Promise<boolean> {
    const module = faustEngineState.modules.get(moduleId);
    if (!module) {
        logger.warn(
            `[Faust] Module "${moduleId}" not registered. Available: ${[...faustEngineState.modules.keys()].join(', ')}`
        );
        return false;
    }
    if (module.compiled && module.generator) {
        return true;
    }

    const existingPromise = faustEngineState.compilationPromises.get(moduleId);
    if (existingPromise) {
        return existingPromise;
    }

    const promise = (async () => {
        try {
            const compiler = await getFaustCompiler();
            const processorName = module.name.replaceAll(/\s+/g, '_');
            const args = '-I libraries/';
            let result: FaustMonoDspGenerator | FaustPolyDspGenerator | null;
            if (!module.isInstrument) {
                result = await new FaustMonoDspGenerator().compile(compiler, processorName, module.dspCode, args);
            } else if (module.polyEffectMode === 'none') {
                result = await compileEffectFreeFaustPolyDsp(compiler, processorName, module.dspCode, args);
            } else {
                result = await new FaustPolyDspGenerator().compile(compiler, processorName, module.dspCode, args);
            }
            if (!result) {
                logger.warn(`[Faust] Compilation returned null for "${module.name}". DSP code may have syntax errors.`);
                return false;
            }
            module.generator = result;
            module.compiled = true;
            faustEngineState.modules.set(moduleId, module);
            return true;
        } catch (error) {
            logger.warn(`[Faust] Compilation failed for "${module.name}": ${getFaustErrorMessage(error)}`);
            return false;
        } finally {
            faustEngineState.compilationPromises.delete(moduleId);
        }
    })();

    faustEngineState.compilationPromises.set(moduleId, promise);
    return promise;
}

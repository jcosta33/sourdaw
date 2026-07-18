import { FaustPolyDspGenerator, type IFaustMonoWebAudioNode, type IFaustPolyWebAudioNode } from '@grame/faustwasm';

import { logger } from '#/infra/logger/appLogger';

import { type FaustModule } from '../../models/FaustEngineTypes';

import { faustEngineState } from './faustEngineState';
import { getFaustErrorMessage } from './getFaustErrorMessage';

const POLY_VOICES_DEFAULT = 8;

export async function createFaustNode(
    moduleId: string,
    context: BaseAudioContext
): Promise<IFaustMonoWebAudioNode | IFaustPolyWebAudioNode | null> {
    const module = faustEngineState.modules.get(moduleId);
    if (!module?.generator || !module.compiled) {
        const reason = faustEngineState.compiler.error
            ? `Compiler unavailable: ${faustEngineState.compiler.error}`
            : 'Module not compiled';
        logger.warn(`[Faust] Cannot create node for "${moduleId}": ${reason}`);
        return null;
    }

    const previous = faustEngineState.contextCreateLock.get(context) ?? Promise.resolve();
    const self = previous.then(() => attemptCreateNode(module, context));
    faustEngineState.contextCreateLock.set(
        context,
        self.catch(() => undefined)
    );
    return self;
}

async function attemptCreateNode(
    module: FaustModule,
    context: BaseAudioContext
): Promise<IFaustMonoWebAudioNode | IFaustPolyWebAudioNode | null> {
    const generator = module.generator;
    if (!generator) {
        return null;
    }

    function invoke(activeGenerator: NonNullable<FaustModule['generator']>) {
        return activeGenerator instanceof FaustPolyDspGenerator
            ? activeGenerator.createNode(context, POLY_VOICES_DEFAULT)
            : activeGenerator.createNode(context);
    }
    try {
        return await invoke(generator);
    } catch (error) {
        const message = getFaustErrorMessage(error);
        if (message.includes('already registered')) {
            try {
                return await invoke(generator);
            } catch (retryError) {
                logger.warn(`[Faust] Node creation retry failed for "${module.name}":`, retryError);
            }
        } else if (message.includes('is not defined in AudioWorkletGlobalScope')) {
            let backoff = 20;
            const maxRetries = 5;
            for (let retry = 0; retry < maxRetries; retry += 1) {
                await new Promise<void>((resolve) => setTimeout(resolve, backoff));
                try {
                    return await invoke(generator);
                } catch (retryError) {
                    if (retry === maxRetries - 1) {
                        logger.warn(`[Faust] Node creation retry failed for "${module.name}":`, retryError);
                    } else {
                        backoff *= 2;
                    }
                }
            }
        }

        logger.warn(`[Faust] Node creation failed for "${module.name}": ${message}`);
        return null;
    }
}

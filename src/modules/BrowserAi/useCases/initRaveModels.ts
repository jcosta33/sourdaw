import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { checkModelCached } from '../repositories/checkModelCached';
import { FACTORY_MODELS, RAVE_MODEL_FAMILY, raveStore, type RaveModel } from '../stores/rave';

/**
 * Use case: register the RAVE models whose weights are actually present in OPFS.
 *
 * This is the only production writer of `raveStore.models`, and every RAVE
 * surface (command palette entries, `loadModel`) gates on that list. No RAVE
 * weights are shipped or hosted today, so the probe finds nothing and the
 * surface stays withheld — and it returns on its own the day the weights land
 * in OPFS, with no code change.
 *
 * A probe that fails for a reason other than a genuine miss (permission
 * failure, corrupt OPFS) is treated as absent and warned about: an unreadable
 * model is not a usable model, and withholding is the honest verdict.
 */
export const initRaveModels = inject({ logger, checkModelCached })(
    ({ logger, checkModelCached }) =>
        async function initRaveModels(): Promise<void> {
            const state = raveStore.value;
            if (!state) {
                return;
            }

            const probes = await Promise.all(
                FACTORY_MODELS.map(async (model) => {
                    try {
                        return await checkModelCached({ family: RAVE_MODEL_FAMILY, modelId: model.id });
                    } catch (error) {
                        logger.warn(`[BrowserAi] RAVE presence probe failed for ${model.id}: ${String(error)}`);
                        return false;
                    }
                })
            );

            const present: RaveModel[] = [];
            for (const [index, model] of FACTORY_MODELS.entries()) {
                if (probes[index]) {
                    present.push({ ...model, loaded: false });
                }
            }

            const presentIds = new Set(present.map((model) => model.id));
            let activeModelId: string | null = null;
            if (state.activeModelId !== null && presentIds.has(state.activeModelId)) {
                activeModelId = state.activeModelId;
            }

            raveStore.set({ ...state, models: present, activeModelId });

            logger.info(`[BrowserAi] RAVE models present: ${String(present.length)}/${String(FACTORY_MODELS.length)}`);
        }
);

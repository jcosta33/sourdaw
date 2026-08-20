import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { checkModelCached } from '../repositories/checkModelCached';
import { FACTORY_MODELS, RAVE_MODEL_FAMILY, raveStore, type RaveModel } from '../stores/rave';

/**
 * Use case: register the RAVE models whose weights are actually present in OPFS.
 *
 * This is the only production writer of `raveStore.models`, and every RAVE
 * surface (command palette entries, `loadModel`) gates on that list. No RAVE
 * weights are shipped or hosted today, so the probe finds nothing and the
 * surface stays withheld.
 *
 * Re-enabling is *not* purely a matter of dropping files in OPFS, and two
 * things have to line up first. The probe asks for `rave/<model.id>` (via
 * `toOpfsPath`, which is `${family}/${modelId}`), while `FACTORY_MODELS`
 * declares `modelPath: 'models/rave/strings.onnx'` — different strings — and
 * `downloadModel`, the only writer OPFS has, is never called with
 * `family: 'rave'` by any caller. So nothing can currently make this probe
 * return true. That is fail-closed and therefore safe, but it means shipping
 * RAVE needs a download entry keyed to family `rave` whose stored name matches
 * the model id, not just weights appearing from somewhere.
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
            if (!MODEL_RELEASE_ADMISSION.rave) {
                raveStore.set({ ...state, models: [], activeModelId: null });
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

import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { raveStore } from '../../stores/rave';

/**
 * Use case: report whether a RAVE model's weights are actually present.
 *
 * `initRaveModels` is the only production writer of `raveStore.models`, and it
 * registers only what it found in OPFS — so membership of that list *is* the
 * presence answer.
 *
 * This exists so foreign modules can ask the question without holding the store
 * handle. Exporting `raveStore` from the contract barrel would make
 * `raveStore.set` callable from any module, and `sourdaw/no-foreign-store-write`
 * is warn-only under CI's `lint --quiet` — nothing would fail if a later caller
 * re-registered the catalog presence-blind from outside BrowserAi, which is
 * precisely the state this module was fixed out of.
 */
export function isRaveModelPresent(modelId: string): boolean {
    return MODEL_RELEASE_ADMISSION.rave && (raveStore.value?.models.some((model) => model.id === modelId) ?? false);
}

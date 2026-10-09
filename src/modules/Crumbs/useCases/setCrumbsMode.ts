/**
 * Switch crumbs operating mode (Quick/Drum/Slice/Warp).
 *
 * Three destinations. The session store drives the panel; the native
 * `CrumbsInstance` behind `set_crumbs_param` is the sample-acquisition and
 * disk-streaming path, still addressed because desynchronising it silently is
 * a second bug rather than a cleanup; and the worklet in the track strip — the
 * thing the user actually hears — learns the mode through the
 * `crumbs.modeChanged` signal, which the composition root's subscription turns
 * into the strip write.
 *
 * The strip write used to be missing entirely, so a mid-session Quick→Slice
 * moved the panel and the persisted document and left the audio alone (see the
 * composition-root subscription for the history). It travels as a signal
 * rather than a direct strip call because this module's barrel is imported by
 * AudioEngine, so a barrel-reachable path back into the strip's owner closes a
 * `no-circular` cycle the boundary gate refuses.
 */

import { logger } from '#/infra/logger/appLogger';

import { setCrumbsMode } from '../repositories/crumbsBridge/setCrumbsMode';
import { emitCrumbsModeChanged } from '../stores/crumbsEventBus';
import { setMode } from '../stores/crumbsStore';

import type { CrumbsMode } from '../models/CrumbsTypes';

export async function switchCrumbsMode(instanceId: string, mode: CrumbsMode): Promise<void> {
    setMode(instanceId, mode);
    emitCrumbsModeChanged({ deviceId: instanceId, mode });
    try {
        await setCrumbsMode(instanceId, mode);
    } catch (error) {
        logger.warn('Failed to crumbs mode:', error);
    }
}

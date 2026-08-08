/**
 * Switch crumbs operating mode (Quick/Drum/Slice/Warp).
 *
 * Three destinations, and the middle one is new. The session store drives the
 * panel; the worklet in the track strip is what the user hears; the native
 * `CrumbsInstance` behind `set_crumbs_param` is the sample-acquisition and
 * disk-streaming path, still addressed because desynchronising it silently is a
 * second bug rather than a cleanup.
 *
 * The strip write used to be missing entirely, so a mid-session Quick→Slice
 * moved the panel and the document and left the audio alone. See
 * `sendCrumbsModeToEngine` for why it is a live-only edge.
 */

import { logger } from '#/infra/logger/appLogger';

import { setCrumbsMode } from '../repositories/crumbsBridge/setCrumbsMode';
import { setMode } from '../stores/crumbsStore';

import { sendCrumbsModeToEngine } from './sendCrumbsModeToEngine';

import type { CrumbsMode } from '../models/CrumbsTypes';

export async function switchCrumbsMode(instanceId: string, mode: CrumbsMode): Promise<void> {
    setMode(instanceId, mode);
    sendCrumbsModeToEngine(instanceId, mode);
    try {
        await setCrumbsMode(instanceId, mode);
    } catch (error) {
        logger.warn('Failed to crumbs mode:', error);
    }
}

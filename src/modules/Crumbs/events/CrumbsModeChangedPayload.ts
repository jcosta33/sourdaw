import { type CrumbsMode } from '../models/CrumbsTypes';

/**
 * `crumbs.modeChanged` carries the operating mode a Crumbs instance now runs,
 * emitted by whichever route changed it — the panel's mode switch and the
 * inbound project reconciliation alike — so the live strip node can be told
 * without either route reaching into the strip's owner (the app seam
 * subscribes; a module that AudioEngine already imports must never reach
 * back). The payload carries plain identities, so the app event surface stays
 * free of Crumbs implementation types.
 */
export type CrumbsModeChangedPayload = {
    deviceId: string;
    mode: CrumbsMode;
};

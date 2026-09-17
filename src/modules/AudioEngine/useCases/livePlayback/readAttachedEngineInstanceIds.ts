/**
 * The instance ids the engine reports attached: hosted plugin instances by
 * instance id, Crumbs instances by device id (#4204).
 *
 * Two populations, one set, because every reader asks the same question of a
 * device on a chain — does the engine hold the instance this device names? —
 * and `map_device` answers both the same way: it splices in an engine-owned
 * instance it already holds, or it refuses the device by name. The id spaces do
 * not collide: a hosted plugin's instance id is minted by the plugin host, and
 * a Crumbs instance is created under the device's own id.
 *
 * One set rather than two inputs threaded through the carrier law, the note
 * sink and the MIDI writer: a caller that read one and not the other would
 * leave half the engine's attachments invisible on that route, which is exactly
 * how a plugin the engine is running stays reported as degraded for a whole
 * session.
 */

import { readAttachedCrumbsInstanceIds } from '#/modules/Crumbs/stores';

import { readAttachedExternalInstanceIds } from './readAttachedExternalInstanceIds';

export function readAttachedEngineInstanceIds(): ReadonlySet<string> {
    return new Set([...readAttachedExternalInstanceIds(), ...readAttachedCrumbsInstanceIds()]);
}

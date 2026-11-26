/**
 * Splice every instance a batch reported the engine took (#3575).
 *
 * Only an applied batch can report an attach: the native attach runs behind
 * the batch's fence.
 */

import { type AudioGraphApplyResult } from '../../models/AudioGraphBackend';

import { spliceAttachedInstances } from './spliceAttachedInstances';

export function spliceInstancesAttachedBy(result: AudioGraphApplyResult): void {
    if (result.application !== 'applied') {
        return;
    }
    spliceAttachedInstances(result.attachedPlugins ?? []);
}

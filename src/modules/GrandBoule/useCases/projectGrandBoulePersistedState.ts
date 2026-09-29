import { type GrandBoulePersistedState, readGrandBouleDeviceState } from '../models/GrandBouleDeviceState';

import { findGrandBouleDevice } from './findGrandBouleDevice';

/**
 * Read the device's persisted state the way `commitGrandBouleDeviceState`'s
 * before-side does: fresh from the track's current chunk, with the decoder's
 * defaults when the device or its chunk is absent. The session store is a
 * mirror another peer's device-state action can leave behind, so a commit that
 * sourced the untouched leaves from it would clobber project truth with the
 * stale copy — the temperament the chunk holds must survive a morph drag it
 * never took part in. Every device-state commit sources the leaves it does not
 * own here, which also keeps `commitGrandBouleDeviceState`'s no-op guard
 * comparing like-for-like projections.
 */
export function projectGrandBoulePersistedState(deviceId: string): GrandBoulePersistedState {
    return readGrandBouleDeviceState(findGrandBouleDevice(deviceId)?.deviceState);
}

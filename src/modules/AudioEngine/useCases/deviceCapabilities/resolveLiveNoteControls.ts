import { resolveLiveNoteControls as resolveByDeviceType } from '../../models/LiveNoteControlsByDeviceType';

/**
 * The worklet note controls a device type's engine node exposes (the controls
 * key, the velocity unit its `noteOn` takes, the expression it sounds), or null
 * for a device with none.
 */
export function resolveLiveNoteControls(deviceType: string): ReturnType<typeof resolveByDeviceType> {
    return resolveByDeviceType(deviceType);
}

import { classifyNoteReceivingDevice as classifyByDeviceType } from '../../models/NoteInputKindByDeviceType';

/** The note-input family of one device type, or null for a device that takes no notes. */
export function classifyNoteReceivingDevice(
    deviceType: string,
    isFaustInstrument: (deviceType: string) => boolean
): ReturnType<typeof classifyByDeviceType> {
    return classifyByDeviceType(deviceType, isFaustInstrument);
}

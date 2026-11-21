import { voicesPerNoteArticulation as voicesPerNoteArticulationType } from '../../models/PerNoteArticulationByDeviceType';

/** True when the device type voices a per-note articulation. */
export function voicesPerNoteArticulation(deviceType: string): boolean {
    return voicesPerNoteArticulationType(deviceType);
}

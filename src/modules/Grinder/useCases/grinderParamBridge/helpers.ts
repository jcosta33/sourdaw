import { getAllTracks, persistDeviceParam } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
export type DeviceRef = { trackId: string; deviceId: string };
export type GetAllTracksFn = typeof getAllTracks;
export type UpdateDeviceParamFn = typeof updateDeviceParam;
export type PersistDeviceParamFn = typeof persistDeviceParam;

export function createFindDeviceRef(getAllTracksFn: GetAllTracksFn) {
    return function findDeviceRef(deviceId: string): DeviceRef | null {
        for (const track of getAllTracksFn()) {
            if (track.devices.some((d) => d.id === deviceId)) {
                return { trackId: track.id, deviceId };
            }
        }
        return null;
    };
}

export const AMP_MODELS = ['clean-twin', 'crunch-jcm', 'lead-jcm', 'ac30-tb', 'rectifier', 'custom'] as const;
export const ENGINE_MODES = ['circuit', 'capture', 'hybrid'] as const;
export const INPUT_MODES = ['instrument', 'line', 'reamp'] as const;
export const TONE_STACK_TYPES = ['fender', 'marshall', 'vox'] as const;
export const POWER_TUBE_TYPES = ['6l6', 'el34', 'el84'] as const;
export const RECTIFIER_TYPES = ['tube', 'solid-state', 'variac'] as const;
export const NEURAL_PLACEMENTS = ['amp-capture', 'rig-capture'] as const;
export const NEURAL_TIERS = ['standard', 'lite', 'nano', 'recurrent'] as const;
export const ROUTING_MODES = ['serial', 'parallel', 'wet-dry-wet', 'dual-amp'] as const;
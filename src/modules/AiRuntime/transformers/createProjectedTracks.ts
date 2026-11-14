import { toLevelDb } from '#/utils/audioLevelLaw';

import { type ProjectContextTrack } from '../models/ProjectContext';

export function createProjectedBus(busId: string, name: string): ProjectContextTrack {
    return {
        id: busId,
        name,
        kind: 'bus',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        frozen: false,
        gain: 1,
        gainDb: toLevelDb(1),
        pan: 0,
        automationMode: 'read',
        vcaGroupId: null,
        outputId: 'master',
        clipCount: 0,
        alternativeClipIds: [],
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    };
}

export function createProjectedTrack(
    trackId: string,
    name: string,
    kind: string,
    initialDeviceId: string | undefined
): ProjectContextTrack {
    const devices: ProjectContextTrack['devices'] = [];
    if (kind === 'midi' && initialDeviceId !== undefined) {
        devices.push({ id: initialDeviceId, name: 'Synth', type: 'builtin-synth', bypassed: false, parameters: [] });
    }
    return {
        id: trackId,
        name,
        kind,
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        frozen: false,
        gain: 0.8,
        gainDb: toLevelDb(0.8),
        pan: 0,
        automationMode: 'read',
        vcaGroupId: null,
        outputId: 'master',
        clipCount: 0,
        alternativeClipIds: [],
        deviceCount: devices.length,
        clips: [],
        devices,
        sends: [],
    };
}

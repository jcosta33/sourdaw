import { audioEngine } from '../repositories/createWebAudioEngine';

import { engineDeviceCollaborators } from './engineDeviceCollaborators';

/** Startup wiring: hands the live engine the use cases its device graph writes through. */
export function initEngineDeviceCollaborators(): void {
    audioEngine.setUseCaseDeviceCollaborators(engineDeviceCollaborators);
}

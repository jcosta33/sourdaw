import { inject } from '#/infra/di/inject';

import { audioEngine } from '../repositories/createWebAudioEngine';

import { engineDeviceCollaborators } from './engineDeviceCollaborators';

/** Startup wiring: hands the live engine the use cases its device graph writes through. */
export const initEngineDeviceCollaborators = inject({ audioEngine })(
    ({ audioEngine }) =>
        function initEngineDeviceCollaborators(): void {
            audioEngine.setUseCaseDeviceCollaborators(engineDeviceCollaborators);
        }
);

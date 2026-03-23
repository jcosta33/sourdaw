// Types
export type {
    ControlSurfaceProtocol,
    McuFaderState,
    McuState,
    OscEndpoint,
    OscMapping,
    ControlSurfaceState,
} from '#/modules/AudioEngine/stores/controlSurface';
export { controlSurfaceStore } from '#/modules/AudioEngine/stores/controlSurface';

// Protocol
export { setProtocol } from './setProtocol';

// MCU
export { mcuSetFader } from './mcuSetFader';
export { mcuBankLeft } from './mcuBankLeft';
export { mcuBankRight } from './mcuBankRight';
export { mcuSetMode } from './mcuSetMode';
export { mcuUpdateTimecode } from './mcuUpdateTimecode';

// OSC
export { addOscEndpoint } from './addOscEndpoint';
export { removeOscEndpoint } from './removeOscEndpoint';
export { addOscMapping } from './addOscMapping';
export { processOscMessage } from './processOscMessage';

// Connection
export { setConnected } from './setConnected';

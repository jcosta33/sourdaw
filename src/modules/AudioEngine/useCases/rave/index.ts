// Types
export type { RaveModel, LatentVector, RaveState } from '#/modules/AudioEngine/stores/rave';
export { raveStore } from '#/modules/AudioEngine/stores/rave';

// Model management
export { registerFactoryModels } from './registerFactoryModels';
export { loadModel } from './loadModel';
export { unloadModel } from './unloadModel';

// Encoding / Decoding
export { encodeAudio } from './encodeAudio';
export { decodeLatent } from './decodeLatent';

// Latent space transforms
export { timbreTransfer } from './timbreTransfer';
export { interpolateLatent } from './interpolateLatent';
export { randomizeLatent } from './randomizeLatent';

// Controls
export { setTransferBlend } from './setTransferBlend';
export { setTemperature } from './setTemperature';
export { toggleRealTime } from './toggleRealTime';

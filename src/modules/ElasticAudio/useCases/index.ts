// ElasticAudio/useCases — public contract surface for the elastic-audio editor
// and time-stretch algorithm-selection orchestration (ADR 0011 W4).

export { detectTransients } from './elasticAudio/detectTransients';
export { detectTransientsForClip } from './elasticAudio/detectTransientsForClip';
export { markElasticDetectionComplete } from './elasticAudio/markElasticDetectionComplete';
export { selectElasticMarkers } from './elasticAudio/selectElasticMarkers';
export { openElasticEditor } from './elasticAudio/openElasticEditor';
export { closeElasticEditor } from './elasticAudio/closeElasticEditor';
export { setElasticTool } from './elasticAudio/setElasticTool';
export { setElasticSensitivity } from './elasticAudio/setElasticSensitivity';
export { addManualMarker } from './elasticAudio/addManualMarker';
export { removeMarker } from './elasticAudio/removeMarker';
export { toggleMarkerLock } from './elasticAudio/toggleMarkerLock';
export { quantizeTransients } from './elasticAudio/quantizeTransients';

export { enableWarping } from './audioWarping/enableWarping';
export { setWarpAlgorithm } from './audioWarping/setWarpAlgorithm';
export { setPitchShift } from './audioWarping/setPitchShift';
export { setDefaultAlgorithm } from './audioWarping/setDefaultAlgorithm';
export { getAlgorithmInfo } from './audioWarping/getAlgorithmInfo';

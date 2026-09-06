export { applyFermenterRuntimeParam } from './applyFermenterRuntimeParam';
export { setFermenterDependencies } from './fermenterDependencies';
export { getFermenterFactoryPresets } from './getFermenterFactoryPresets';
// The descriptor-id → DSP-name translation the live write path uses. Published
// because the offline automation ordinal pin needs the same translation to
// derive Rust parameter names from the TS ordinal map rather than restating
// them: the two sides spell parameters differently on purpose, and this is the
// single place that difference is defined.
export { mapFermenterParamToDspParam } from './fermenterParamBridge/mapFermenterParamToDspParam';
// The whole-patch form of the same translation. Published because the native
// carrier sends a built-in's patch as one record of the engine's own names, so
// the renderer's registry of native bodies has to spell a Fermenter's patch the
// way this module spells it rather than restating the mapping.
export { mapFermenterPatchToDspPatch } from './fermenterParamBridge/mapFermenterPatchToDspPatch';
export { FERMENTER_PARAMS } from './fermenterQueries/FERMENTER_PARAMS';
export { setFermenterMappedParam } from './setFermenterMappedParam';

// The matcher itself lives in `#/utils/deviceTypeMatching` so the offline
// renderer shares this exact definition rather than keeping a second copy of
// the arms; AudioEngine cannot import Transport without closing a dependency
// cycle. Re-exported here so the live scheduling call sites keep their local
// import.
export { isDrumDevice } from '#/utils/deviceTypeMatching';

/**
 * Browser files that must run against the Vite dev server: they, or a helper
 * they import, load `/src/...` module URLs at runtime, and a production build
 * serves no such URLs. CI browser shards serve a production-mode build and
 * route these files to a dev server instead (see ../../playwright.config.ts).
 * scripts/__tests__/e2eDevServerOnlySpecs.spec.ts keeps this list honest in
 * both directions.
 */
export const devServerOnlySpecs: readonly string[] = [
    'tests/e2e/agentWorkspace.spec.ts',
    'tests/e2e/aiConfirmApplyUndo.spec.ts',
    'tests/e2e/audioOwnership.native.spec.ts',
    'tests/e2e/browserAiWebGpuAdmission.spec.ts',
    'tests/e2e/browserDisplayScale.spec.ts',
    'tests/e2e/builtinDeviceAutomationOffline.spec.ts',
    'tests/e2e/crdtPersistence.native.spec.ts',
    'tests/e2e/monoModulationInput.spec.ts',
    'tests/e2e/pianoRollDockAcceptance.spec.ts',
    'tests/e2e/smoke.spec.ts',
    'tests/e2e/spatialPannerArrangementTestId.spec.ts',
];

export const ORIGINAL_HEAD = '94aa5ab19a617fc7a3de83fa7aa8afde8b3361b9';
export const ORIGINAL_TREE = '06b54aebbe87cf3e9ac09b247580b0e6dceb15fa';
export const ORIGINAL_SPEC = 'tests/e2e/persistedClipEditAcceptance.spec.ts';
export const ORIGINAL_SPEC_SHA256 = '288b3316fe4e0dd2aa2d4a6fc78d217b15f5a1e8243845f5f979e9b9200f9f9e';
export const ORIGINAL_NODE = 'v24.19.0';
export const ORIGINAL_BROWSER = '153.0.8010.12';
export const ORIGINAL_PLAYWRIGHT = '1.63.0';
export const WRAPPER = 'tests/e2e/test-results/reloadCancellation/zzPersistedClip.diagnostic.spec.ts';
export const PRIVATE_DIRECTORY = 'test-results/reloadCancellation/harness';
// Set to the verified published preparation head only in the single enable commit.
// Its successor (including the freeze commit) cannot satisfy the same event.before.
export const NATIVE_EXECUTION_PARENT: string | undefined = '7500e21497be9f146d928062aca8652c6a80cf3b';

// Frozen selectors from run40908733061 attempt1, rather than a fresh affected-plan calculation.
export const ORIGINAL_SELECTORS = [
    'tests/e2e/additionalUi.spec.ts',
    'tests/e2e/agentWorkspace.spec.ts',
    'tests/e2e/automationPointDrawUndo.spec.ts',
    'tests/e2e/bakeryControlGeometry.spec.ts',
    'tests/e2e/browserAiTestId.spec.ts',
    'tests/e2e/browserAiWebGpuAdmission.spec.ts',
    'tests/e2e/chatComposerTestId.spec.ts',
    'tests/e2e/clipTrimFadeKeyboardTestId.spec.ts',
    'tests/e2e/crdtPersistence.native.spec.ts',
    'tests/e2e/crustInputGainTestId.spec.ts',
    'tests/e2e/crustStreamingPresetTestId.spec.ts',
    'tests/e2e/dynamicAndEdge.spec.ts',
    'tests/e2e/e2eWorkflow.spec.ts',
    'tests/e2e/fermenterFxDistKnobsDepthTestId.spec.ts',
    'tests/e2e/generatePanelTestId.spec.ts',
    'tests/e2e/importErrorPathsTestId.spec.ts',
    'tests/e2e/kneadPitchDeepTestId.spec.ts',
    'tests/e2e/llmBadgeDownload.spec.ts',
    'tests/e2e/masterChannelTestId.spec.ts',
    'tests/e2e/midiClipDeepTestId.spec.ts',
    'tests/e2e/midiUndoPlaybackTestId.spec.ts',
    'tests/e2e/multiTrackWorkflowTestId.spec.ts',
    ORIGINAL_SPEC,
    'tests/e2e/pianoRollZoomTestId.spec.ts',
    'tests/e2e/proofEqKnobsTestId.spec.ts',
    'tests/e2e/toasterPadMixerTestId.spec.ts',
    'tests/e2e/trackContextMenuTestId.spec.ts',
    'tests/e2e/transportDeep.spec.ts',
] as const;

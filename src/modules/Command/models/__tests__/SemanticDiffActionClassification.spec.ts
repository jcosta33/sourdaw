import { describe, expect, it } from 'vitest';

import { semanticDiffClassificationByActionType } from '../SemanticDiffActionClassification';

// Each flag lists its expected action types independently of the production classification.
const expectedByFlag = {
    created: [
        'addTrack',
        'createBus',
        'duplicateTrack',
        'addClip',
        'duplicateClip',
        'duplicateClipToNextBar',
        'splitClip',
        'quantizeTransients',
        'stripSilence',
        'extractGroove',
        'createVcaGroup',
        'addDevice',
        'addSend',
        'addSidechainRoute',
        'addAdjustmentRegion',
        'addAutomationLane',
        'addAutomationPoint',
        'addMarker',
        'addSection',
    ],
    moved: [
        'moveAdjustmentRegion',
        'moveChordEvent',
        'moveClip',
        'nudgeClip',
        'quantizeTransients',
        'reorderTrack',
        'trimClipEnd',
        'trimClipStart',
    ],
    routed: [
        'createBus',
        'addSend',
        'setSend',
        'removeSend',
        'setTrackOutput',
        'addSidechainRoute',
        'removeSidechainRoute',
    ],
    project: [
        'setTempo',
        'setTimeSignature',
        'addTimeSignatureChange',
        'removeTimeSignatureChange',
        'setProductionBrief',
        'insertTime',
        'deleteTime',
        'duplicateTimeRange',
    ],
    replacement: [
        'bounceInPlace',
        'flattenTrack',
        'freezeTrack',
        'loadPreset',
        'loadTrackTemplate',
        'quantizeTransients',
        'stripSilence',
        'restoreProjectVersion',
    ],
    consolidation: ['glueClips', 'consolidateAllTracks', 'consolidateSelection', 'createCompGroup'],
    overwrite: [
        'copyMidiArticulations',
        'commitScratchPad',
        'insertAutomationLanePoints',
        'setDeviceState',
        'setExternalPluginState',
        'setProductionBrief',
    ],
    sourceMutation: ['commitPitchEdit', 'normalizeClip', 'reverseClip', 'enableWarping', 'setClipWarpState'],
    externalEffect: [
        'renderProjectSections',
        'importStemSet',
        'importAudioFile',
        'importDawProject',
        'importMidiFile',
        'exportDawProject',
        'exportMidi',
        'exportProject',
        'stemSeparate',
        'audioToMidi',
    ],
    structuralAudio: [
        'setTempo',
        'setTimeSignature',
        'addTrack',
        'removeTrack',
        'createBus',
        'addDevice',
        'removeDevice',
        'addSend',
        'setSend',
        'removeSend',
        'setTrackOutput',
        'addSidechainRoute',
        'removeSidechainRoute',
    ],
    noAudio: [
        'addMarker',
        'removeMarker',
        'setMarkerColor',
        'addSection',
        'removeSection',
        'renameSection',
        'renameTrack',
        'renameClip',
        'setTrackColor',
        'setClipColor',
        'selectTrack',
    ],
} as const;

describe('semanticDiffClassificationByActionType', () => {
    for (const [flag, expected] of Object.entries(expectedByFlag)) {
        it(`classifies exactly the expected ${flag} action types`, () => {
            const actual = Object.entries(semanticDiffClassificationByActionType)
                .filter(([, classification]) => (classification as Record<string, true | undefined>)[flag] === true)
                .map(([actionType]) => actionType);
            expect(new Set(actual)).toEqual(new Set(expected));
            expect(actual).toHaveLength(expected.length);
        });
    }
});

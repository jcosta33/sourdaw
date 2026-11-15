import { describe, expect, it } from 'vitest';

import { commandBatchEffectByActionType } from '../CommandBatchActionEffect';

// The sets the classification replaced, copied verbatim so the record cannot drift from them.
const expectedByFlag = {
    create: [
        'importStemSet',
        'addTrack',
        'createBus',
        'duplicateTrack',
        'addClip',
        'duplicateClip',
        'duplicateClipToNextBar',
        'splitClip',
        'glueClips',
        'quantizeTransients',
        'stripSilence',
        'drawClip',
        'duplicateClipAt',
        'addNotes',
        'arpeggiate',
        'extractGroove',
        'createDrumPreviewBranches',
        'createVcaGroup',
        'addDevice',
        'addYeastProcessor',
        'addSend',
        'addSidechainRoute',
        'addAdjustmentRegion',
        'addAutomationLane',
        'addAutomationPoint',
        'automateSendRange',
        'automateSendRanges',
        'automateTrackGainRange',
        'automateParameterRange',
        'renderProjectSections',
        'addMarker',
        'addSection',
    ],
    delete: [
        'removeTrack',
        'removeClip',
        'removeMarker',
        'removeSection',
        'removeDevice',
        'removeYeastProcessor',
        'removeSend',
        'removeSidechainRoute',
        'glueClips',
        'stripSilence',
        'arpeggiate',
        'thinAutomation',
        'quantizeAutomation',
        'automateParameterRange',
    ],
    routing: [
        'createBus',
        'addSend',
        'setSend',
        'removeSend',
        'setTrackOutput',
        'addSidechainRoute',
        'removeSidechainRoute',
    ],
    tempo: ['setTempo', 'setTimeSignature'],
    master: ['setMasterGain'],
    file: ['importStemSet', 'renderProjectSections'],
    audioUpload: ['importStemSet'],
} as const;

describe('commandBatchEffectByActionType', () => {
    for (const [flag, expected] of Object.entries(expectedByFlag)) {
        it(`classifies exactly the original ${flag} action types`, () => {
            const actual = Object.entries(commandBatchEffectByActionType)
                .filter(([, classification]) => (classification as Record<string, true | undefined>)[flag] === true)
                .map(([actionType]) => actionType);
            expect(new Set(actual)).toEqual(new Set(expected));
            expect(actual).toHaveLength(expected.length);
        });
    }
});

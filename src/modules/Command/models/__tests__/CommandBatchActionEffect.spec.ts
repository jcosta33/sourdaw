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

describe('commandBatchEffectByActionType count readers', () => {
    const readerFields = [
        'createdTracks',
        'deletedObjects',
        'automationPoints',
        'importedAssets',
        'renderJobs',
    ] as const;
    const expectedReaders = {
        createdTracks: ['addTrack', 'createBus', 'duplicateTrack', 'importStemSet'],
        deletedObjects: ['glueClips', 'removeTrack', 'thinAutomation'],
        automationPoints: [
            'addAutomationPoint',
            'automateParameterRange',
            'automateSendRange',
            'automateSendRanges',
            'automateTrackGainRange',
        ],
        importedAssets: ['importStemSet'],
        renderJobs: ['renderProjectSections'],
    };

    for (const field of readerFields) {
        it(`declares a ${field} reader for exactly the original action types`, () => {
            const actual = Object.entries(commandBatchEffectByActionType)
                .filter(([, effect]) => effect[field] !== undefined)
                .map(([actionType]) => actionType);
            expect(actual.toSorted()).toEqual(expectedReaders[field]);
        });
    }

    it('reads each figure from the command arguments', () => {
        const ids = { trackIds: ['a', 'b'], sectionIds: ['s'], stems: [1, 2, 3] };
        expect(commandBatchEffectByActionType.importStemSet.createdTracks?.(ids)).toBe(4);
        expect(commandBatchEffectByActionType.automateSendRanges.automationPoints?.(ids)).toBe(4);
        expect(commandBatchEffectByActionType.removeTrack.deletedObjects?.({ expectedClipIds: [1] })).toBe(2);
        expect(commandBatchEffectByActionType.glueClips.deletedObjects?.({})).toBe(1);
        expect(commandBatchEffectByActionType.automateParameterRange.automationPoints?.({})).toBe(5);
        expect(commandBatchEffectByActionType.automateSendRange.automationPoints?.(ids)).toBe(4);
        expect(commandBatchEffectByActionType.renderProjectSections.renderJobs?.(ids)).toBe(1);
        expect(commandBatchEffectByActionType.importStemSet.importedAssets?.(ids)).toBe(3);
        expect(commandBatchEffectByActionType.thinAutomation.deletedObjects?.(ids)).toBe(0);
    });
});

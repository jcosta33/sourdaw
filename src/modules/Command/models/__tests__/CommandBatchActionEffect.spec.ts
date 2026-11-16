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

    type ReaderRow = {
        type: keyof typeof commandBatchEffectByActionType;
        field: (typeof readerFields)[number];
        args: Readonly<Record<string, unknown>>;
        expected: number;
    };
    // Argument lengths differ per key so a reader that reads the wrong key or drops a factor fails.
    const sized = { trackIds: ['a', 'b', 'c'], sectionIds: ['s', 't'], stems: [1, 2, 3, 4] };
    const rows: readonly ReaderRow[] = [
        { type: 'addTrack', field: 'createdTracks', args: {}, expected: 1 },
        { type: 'createBus', field: 'createdTracks', args: {}, expected: 1 },
        { type: 'duplicateTrack', field: 'createdTracks', args: {}, expected: 1 },
        { type: 'importStemSet', field: 'createdTracks', args: sized, expected: 5 },
        { type: 'importStemSet', field: 'importedAssets', args: sized, expected: 4 },
        {
            type: 'removeTrack',
            field: 'deletedObjects',
            args: { expectedClipIds: [1], expectedAlternativeClipIds: [1, 2] },
            expected: 4,
        },
        { type: 'glueClips', field: 'deletedObjects', args: { clipIds: ['a', 'b', 'c'] }, expected: 3 },
        { type: 'glueClips', field: 'deletedObjects', args: {}, expected: 1 },
        { type: 'thinAutomation', field: 'deletedObjects', args: sized, expected: 0 },
        { type: 'addAutomationPoint', field: 'automationPoints', args: sized, expected: 1 },
        { type: 'automateParameterRange', field: 'automationPoints', args: {}, expected: 5 },
        { type: 'automateSendRange', field: 'automationPoints', args: sized, expected: 6 },
        { type: 'automateSendRanges', field: 'automationPoints', args: sized, expected: 12 },
        { type: 'automateTrackGainRange', field: 'automationPoints', args: sized, expected: 6 },
        { type: 'renderProjectSections', field: 'renderJobs', args: sized, expected: 2 },
    ];

    it('asserts a figure for every declared reader', () => {
        const covered = rows.map((row) => `${row.type}.${row.field}`);
        const declared = Object.entries(commandBatchEffectByActionType).flatMap(([type, effect]) =>
            readerFields.filter((field) => effect[field] !== undefined).map((field) => `${type}.${field}`)
        );
        expect(new Set(covered)).toEqual(new Set(declared));
    });

    it.each(rows)('$type $field reads $expected from its arguments', ({ type, field, args, expected }) => {
        expect(commandBatchEffectByActionType[type][field]?.(args)).toBe(expected);
    });
});

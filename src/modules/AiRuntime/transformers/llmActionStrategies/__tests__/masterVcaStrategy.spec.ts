import { describe, expect, it } from 'vitest';

import { FADER_MAX_GAIN, VCA_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type ProjectContext } from '../../../models/ProjectContext';
import { type RuntimeAction } from '../../../models/RuntimeAction';
import {
    bridgeMasterVcaToolCall,
    masterVcaActionNames,
    masterVcaStrategyRegistry,
    type MasterVcaCallName,
} from '../masterVcaStrategy';

function createTrack({
    id,
    kind,
    vcaGroupId = null,
}: {
    id: string;
    kind: string;
    vcaGroupId?: string | null;
}): ProjectContext['tracks'][number] {
    return {
        id,
        name: id,
        kind,
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        vcaGroupId,
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    };
}

const projectContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 8,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 8,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    vcaGroups: [{ id: 'vca-drums', name: 'Drum VCA', gain: 0.75, muted: false, trackIds: ['track-vocals'] }],
    tracks: [
        createTrack({ id: 'track-vocals', kind: 'audio', vcaGroupId: 'vca-drums' }),
        createTrack({ id: 'bus-reverb', kind: 'bus' }),
        createTrack({ id: 'folder-band', kind: 'folder' }),
        createTrack({ id: 'master', kind: 'master' }),
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

function bridge(call: { arguments: Record<string, unknown>; name: string }, context: ProjectContext = projectContext) {
    return bridgeMasterVcaToolCall({ call, context, index: 7 });
}

type ExactKeyGuardCase<Name extends MasterVcaCallName> = {
    [StrategyName in Name]: {
        action: Extract<RuntimeAction, { type: StrategyName }>;
        arguments: Record<string, unknown>;
        name: StrategyName;
        reason: string;
    };
}[Name];

const exactKeyGuardCases = [
    {
        action: { type: 'setMasterGain', payload: { gain: 0.7 } },
        arguments: { gain: 0.7 },
        name: 'setMasterGain',
        reason: `Expected only a changed finite master gain from 0 through ${FADER_MAX_GAIN}`,
    },
    {
        action: { type: 'setVcaGain', payload: { vcaGroupId: 'vca-drums', gain: 0.7 } },
        arguments: { vcaGroupId: 'vca-drums', gain: 0.7 },
        name: 'setVcaGain',
        reason: `Expected an existing VCA group and a changed finite gain from 0 through ${VCA_MAX_GAIN}`,
    },
    {
        action: { type: 'createVcaGroup', payload: { name: 'Band', trackIds: ['bus-reverb'] } },
        arguments: { name: 'Band', trackIds: ['bus-reverb'] },
        name: 'createVcaGroup',
        reason: 'Expected one safe unique VCA name and a non-empty unique list of eligible existing track IDs',
    },
    {
        action: { type: 'assignToVca', payload: { trackId: 'bus-reverb', vcaGroupId: 'vca-drums' } },
        arguments: { trackId: 'bus-reverb', vcaGroupId: 'vca-drums' },
        name: 'assignToVca',
        reason: 'Expected an eligible existing track and a different or inconsistent existing VCA membership',
    },
    {
        action: { type: 'removeFromVca', payload: { trackId: 'track-vocals' } },
        arguments: { trackId: 'track-vocals' },
        name: 'removeFromVca',
        reason: 'Expected an eligible existing track with current VCA membership',
    },
] as const satisfies readonly ExactKeyGuardCase<MasterVcaCallName>[];

type ExactKeyGuardCaseName = (typeof exactKeyGuardCases)[number]['name'];
type AllExactKeyGuardsCovered = Exclude<MasterVcaCallName, ExactKeyGuardCaseName> extends never ? true : never;

function assertAllExactKeyGuardsCovered(
    cases: AllExactKeyGuardsCovered extends true ? typeof exactKeyGuardCases : never
): typeof exactKeyGuardCases {
    return cases;
}

describe('masterVcaStrategy', () => {
    it('registers the complete family exactly once and leaves unrelated calls for the legacy bridge', () => {
        expect([...masterVcaStrategyRegistry.keys()]).toEqual(masterVcaActionNames);
        expect(bridge({ name: 'setTempo', arguments: { bpm: 128 } })).toBeNull();
    });

    it('rejects extra fields for every master and VCA strategy', () => {
        for (const testCase of assertAllExactKeyGuardsCovered(exactKeyGuardCases)) {
            expect(bridge({ name: testCase.name, arguments: testCase.arguments })).toEqual(testCase.action);
            expect(bridge({ name: testCase.name, arguments: { ...testCase.arguments, unexpected: true } })).toEqual({
                index: 7,
                name: testCase.name,
                reason: testCase.reason,
            });
        }
    });

    it('grounds only changed finite master and VCA gains at their exact bounds', () => {
        expect(bridge({ name: 'setMasterGain', arguments: { gain: 0 } })).toEqual({
            type: 'setMasterGain',
            payload: { gain: 0 },
        });
        expect(bridge({ name: 'setMasterGain', arguments: { gain: FADER_MAX_GAIN } })).toEqual({
            type: 'setMasterGain',
            payload: { gain: FADER_MAX_GAIN },
        });
        expect(bridge({ name: 'setVcaGain', arguments: { vcaGroupId: 'vca-drums', gain: 0 } })).toEqual({
            type: 'setVcaGain',
            payload: { vcaGroupId: 'vca-drums', gain: 0 },
        });
        expect(bridge({ name: 'setVcaGain', arguments: { vcaGroupId: 'vca-drums', gain: VCA_MAX_GAIN } })).toEqual({
            type: 'setVcaGain',
            payload: { vcaGroupId: 'vca-drums', gain: VCA_MAX_GAIN },
        });

        const masterRejections = [
            { gain: Number.NaN },
            { gain: '0.7' },
            { gain: true },
            { gain: -0.01 },
            { gain: FADER_MAX_GAIN + 0.01 },
            { gain: 0.8 },
        ];
        for (const argumentsPayload of masterRejections) {
            expect(bridge({ name: 'setMasterGain', arguments: argumentsPayload })).toEqual({
                index: 7,
                name: 'setMasterGain',
                reason: `Expected only a changed finite master gain from 0 through ${FADER_MAX_GAIN}`,
            });
        }

        const vcaRejections = [
            { vcaGroupId: 'missing', gain: 0.7 },
            { vcaGroupId: 'vca-drums', gain: Number.NaN },
            { vcaGroupId: 'vca-drums', gain: '0.7' },
            { vcaGroupId: 'vca-drums', gain: true },
            { vcaGroupId: 'vca-drums', gain: -0.01 },
            { vcaGroupId: 'vca-drums', gain: VCA_MAX_GAIN + 0.01 },
            { vcaGroupId: 'vca-drums', gain: 0.75 },
        ];
        for (const argumentsPayload of vcaRejections) {
            expect(bridge({ name: 'setVcaGain', arguments: argumentsPayload })).toEqual({
                index: 7,
                name: 'setVcaGain',
                reason: `Expected an existing VCA group and a changed finite gain from 0 through ${VCA_MAX_GAIN}`,
            });
        }
    });

    it('grounds only unique named VCA groups with non-empty unique eligible member lists', () => {
        expect(
            bridge({ name: 'createVcaGroup', arguments: { name: '  Band  ', trackIds: ['bus-reverb', 'folder-band'] } })
        ).toEqual({
            type: 'createVcaGroup',
            payload: { name: 'Band', trackIds: ['bus-reverb', 'folder-band'] },
        });

        const rejectedArguments = [
            { name: 'drum-vca', trackIds: ['bus-reverb'] },
            { name: 'Band', trackIds: [] },
            { name: 'Band', trackIds: ['bus-reverb', 'bus-reverb'] },
            { name: 'Band', trackIds: ['missing'] },
            { name: 'Band', trackIds: ['master'] },
            { name: '   ', trackIds: ['bus-reverb'] },
        ];
        for (const argumentsPayload of rejectedArguments) {
            expect(bridge({ name: 'createVcaGroup', arguments: argumentsPayload })).toEqual({
                index: 7,
                name: 'createVcaGroup',
                reason: 'Expected one safe unique VCA name and a non-empty unique list of eligible existing track IDs',
            });
        }
    });

    it('preserves one-sided VCA membership repair while rejecting canonical membership and invalid targets', () => {
        expect(bridge({ name: 'assignToVca', arguments: { trackId: 'bus-reverb', vcaGroupId: 'vca-drums' } })).toEqual({
            type: 'assignToVca',
            payload: { trackId: 'bus-reverb', vcaGroupId: 'vca-drums' },
        });
        expect(
            bridge(
                { name: 'assignToVca', arguments: { trackId: 'track-vocals', vcaGroupId: 'vca-drums' } },
                {
                    ...projectContext,
                    tracks: projectContext.tracks.map((track) =>
                        track.id === 'track-vocals' ? { ...track, vcaGroupId: null } : track
                    ),
                }
            )
        ).toEqual({
            type: 'assignToVca',
            payload: { trackId: 'track-vocals', vcaGroupId: 'vca-drums' },
        });

        const rejectedArguments = [
            { trackId: 'track-vocals', vcaGroupId: 'vca-drums' },
            { trackId: 'missing', vcaGroupId: 'vca-drums' },
            { trackId: 'master', vcaGroupId: 'vca-drums' },
            { trackId: 'bus-reverb', vcaGroupId: 'missing' },
        ];
        for (const argumentsPayload of rejectedArguments) {
            expect(bridge({ name: 'assignToVca', arguments: argumentsPayload })).toEqual({
                index: 7,
                name: 'assignToVca',
                reason: 'Expected an eligible existing track and a different or inconsistent existing VCA membership',
            });
        }
    });

    it('grounds removals from either inconsistent membership representation and rejects non-members', () => {
        expect(bridge({ name: 'removeFromVca', arguments: { trackId: 'track-vocals' } })).toEqual({
            type: 'removeFromVca',
            payload: { trackId: 'track-vocals' },
        });
        expect(
            bridge(
                { name: 'removeFromVca', arguments: { trackId: 'track-vocals' } },
                {
                    ...projectContext,
                    tracks: projectContext.tracks.map((track) =>
                        track.id === 'track-vocals' ? { ...track, vcaGroupId: null } : track
                    ),
                }
            )
        ).toEqual({
            type: 'removeFromVca',
            payload: { trackId: 'track-vocals' },
        });

        const rejectedArguments = [{ trackId: 'bus-reverb' }, { trackId: 'missing' }, { trackId: 'master' }];
        for (const argumentsPayload of rejectedArguments) {
            expect(bridge({ name: 'removeFromVca', arguments: argumentsPayload })).toEqual({
                index: 7,
                name: 'removeFromVca',
                reason: 'Expected an eligible existing track with current VCA membership',
            });
        }
    });
});

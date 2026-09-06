import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../../models/ProjectContext';
import { collectClearSolosRestrictionClauses } from '../collectClearSolosRestrictionClauses';
import {
    createPostTargetScopeAdmissionStrategyRegistry,
    postTargetScopeActionNames,
    type PostTargetScopeActionName,
} from '../createPostTargetScopeAdmissionStrategyRegistry';
import {
    groundPostTargetScopeAdmission,
    postTargetScopeAdmissionStrategyDefinitions,
} from '../postTargetScopeAdmissionStrategy';

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 4,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 4,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('post-target scope admission strategies', () => {
    it('rejects duplicate registrations', () => {
        expect(() =>
            createPostTargetScopeAdmissionStrategyRegistry(
                [
                    { name: 'removeTrack', transform: () => null },
                    { name: 'removeTrack', transform: () => null },
                ],
                getExecutableAppActionGroundingCatalog(),
                ['removeTrack']
            )
        ).toThrow('Duplicate post-target scope admission strategy: removeTrack');
    });

    it('proves every registered strategy is in the canonical command grounding catalog', () => {
        const catalog = getExecutableAppActionGroundingCatalog();

        expect(() =>
            createPostTargetScopeAdmissionStrategyRegistry<PostTargetScopeActionName>(
                postTargetScopeAdmissionStrategyDefinitions,
                catalog,
                postTargetScopeActionNames
            )
        ).not.toThrow();
    });

    it('rejects a registry strategy missing from the canonical command grounding catalog', () => {
        expect(() =>
            createPostTargetScopeAdmissionStrategyRegistry(
                [{ name: 'removeTrack', transform: () => null }],
                [],
                ['removeTrack']
            )
        ).toThrow('Post-target scope admission strategy is not a canonical executable action: removeTrack');
    });

    it('rejects a missing expected strategy definition', () => {
        expect(() =>
            createPostTargetScopeAdmissionStrategyRegistry<PostTargetScopeActionName>(
                [{ name: 'removeTrack', transform: () => null }],
                getExecutableAppActionGroundingCatalog(),
                ['removeTrack', 'removeClip']
            )
        ).toThrow('Missing post-target scope admission strategy: removeClip');
    });

    it('dispatches registered scope admissions and leaves unregistered actions unchanged', () => {
        const input = {
            actionScope: { matchedIntentPhrase: 'remove track', text: 'remove Missing track' },
            bulkMutedEmptyTrackDeletionTargetIds: null,
            context,
            groundedArguments: { trackId: 'track-missing' },
            plannedActionNames: ['removeTrack'],
            prompt: 'remove Missing track',
        };

        expect(groundPostTargetScopeAdmission({ ...input, actionName: 'removeTrack' })).toBe(
            'Provider track deletion is not explicit in the user request'
        );
        expect(groundPostTargetScopeAdmission({ ...input, actionName: 'setTempo' })).toBeNull();
    });

    it('rejects a rename whose final grounded clip is explicitly protected', () => {
        const protectedClip = {
            id: 'clip-bass-verse',
            name: 'Bass Verse',
            type: 'audio' as const,
            startBeat: 0,
            endBeat: 8,
            noteCount: 0,
        };
        const clipContext: ProjectContext = {
            ...context,
            tracks: [
                {
                    id: 'track-bass',
                    name: 'Bass',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    clipCount: 1,
                    deviceCount: 0,
                    clips: [protectedClip],
                    devices: [],
                },
            ],
        };
        const prompt = 'rename clip to Bridge Solo; leave Bass Verse unchanged';

        expect(
            groundPostTargetScopeAdmission({
                actionName: 'renameClip',
                actionScope: { matchedIntentPhrase: 'rename clip', text: 'rename clip to Bridge Solo' },
                bulkMutedEmptyTrackDeletionTargetIds: null,
                context: clipContext,
                groundedArguments: { clipId: protectedClip.id, name: 'Bridge Solo' },
                plannedActionNames: ['renameClip'],
                prompt,
            })
        ).toBe('Provider clip rename target is explicitly protected');
    });

    it('rejects a clear-solos restriction that lives outside the split clause', () => {
        const input = {
            actionName: 'clearSolos' as const,
            actionScope: { matchedIntentPhrase: 'clear all solos', text: 'clear all solos' },
            bulkMutedEmptyTrackDeletionTargetIds: null,
            context,
            groundedArguments: {},
            plannedActionNames: ['clearSolos'],
        };

        expect(
            groundPostTargetScopeAdmission({
                ...input,
                prompt: 'clear all solos',
            })
        ).toBeNull();
        expect(
            groundPostTargetScopeAdmission({
                ...input,
                prompt: 'clear all solos all but Unnamed',
            })
        ).toBe('Provider clear-solos scope is not explicitly universal');
        expect(
            groundPostTargetScopeAdmission({
                ...input,
                prompt: 'clear all solos but not Unnamed',
            })
        ).toBe('Provider clear-solos scope is not explicitly universal');

        const unnamedContext: ProjectContext = {
            ...context,
            tracks: [
                {
                    id: 'track-unnamed',
                    name: 'Unnamed',
                    kind: 'audio',
                    muted: false,
                    soloed: true,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                    sends: [],
                },
            ],
        };
        const leftoverTrackInput = { ...input, context: unnamedContext };
        expect(
            groundPostTargetScopeAdmission({
                ...leftoverTrackInput,
                prompt: 'clear all solos but Unnamed',
            })
        ).toBe('Provider clear-solos scope is not explicitly universal');
        expect(
            groundPostTargetScopeAdmission({
                ...leftoverTrackInput,
                prompt: 'clear all solos, Unnamed stays soloed',
            })
        ).toBe('Provider clear-solos scope is not explicitly universal');
        expect(
            groundPostTargetScopeAdmission({
                ...leftoverTrackInput,
                prompt: 'clear all solos; Unnamed remains',
            })
        ).toBe('Provider clear-solos scope is not explicitly universal');
    });

    it('rejects leftover restricted clear-solos when a later catalog intent follows Unnamed', () => {
        const leftoverContext: ProjectContext = {
            ...context,
            tracks: [
                {
                    id: 'track-unnamed',
                    name: 'Unnamed',
                    kind: 'audio',
                    muted: false,
                    soloed: true,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                    sends: [],
                },
                {
                    id: 'track-guitar',
                    name: 'Guitar',
                    kind: 'audio',
                    muted: false,
                    soloed: true,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                    sends: [],
                },
            ],
        };
        const input = {
            actionName: 'clearSolos' as const,
            actionScope: { matchedIntentPhrase: 'clear all solos', text: 'clear all solos' },
            bulkMutedEmptyTrackDeletionTargetIds: null,
            context: leftoverContext,
            groundedArguments: {},
            plannedActionNames: ['clearSolos', 'muteTrack'],
        };
        expect(
            groundPostTargetScopeAdmission({
                ...input,
                prompt: 'clear all solos but Unnamed and mute Guitar',
            })
        ).toBe('Provider clear-solos scope is not explicitly universal');
        expect(
            groundPostTargetScopeAdmission({
                ...input,
                prompt: 'clear all solos, Unnamed stays soloed, and mute Guitar',
            })
        ).toBe('Provider clear-solos scope is not explicitly universal');
    });

    it('rejects a dual VCA group reference that lives outside the split clause', () => {
        const vocals = {
            id: 'track-vocals',
            name: 'Vocals',
            kind: 'audio' as const,
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read' as const,
            outputId: 'master',
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
            sends: [],
            vcaGroupId: 'vca-drums',
        };
        const membershipContext: ProjectContext = {
            ...context,
            tracks: [vocals],
            vcaGroups: [
                { id: 'vca-drums', name: 'Drum VCA', gain: 0.75, muted: false, trackIds: [vocals.id] },
                { id: 'vca-vocals', name: 'Vocal VCA', gain: 1, muted: false, trackIds: [] },
            ],
        };
        const input = {
            actionName: 'removeFromVca' as const,
            actionScope: { matchedIntentPhrase: 'unassign', text: 'unassign Vocals from Drum VCA' },
            bulkMutedEmptyTrackDeletionTargetIds: null,
            context: membershipContext,
            groundedArguments: { trackId: vocals.id },
            plannedActionNames: ['removeFromVca'],
        };

        expect(
            groundPostTargetScopeAdmission({
                ...input,
                prompt: 'unassign Vocals from Drum VCA',
            })
        ).toBeNull();
        expect(
            groundPostTargetScopeAdmission({
                ...input,
                prompt: 'unassign Vocals from Drum VCA and Vocal VCA',
            })
        ).toBe('Provider VCA group reference does not match the track current membership');
    });

    it('collects only solo-specific clear-solos restrictions without retaining adjacent action clauses', () => {
        const commaSeparatedPrompt = 'clear all solos, not including Vocals, and mute Guitar but leave Keys soloed';
        expect(
            collectClearSolosRestrictionClauses(commaSeparatedPrompt, [
                { actionType: 'clearSolos', start: 0, end: commaSeparatedPrompt.indexOf(', and mute') },
                {
                    actionType: 'muteTrack',
                    start: commaSeparatedPrompt.indexOf('mute Guitar'),
                    end: commaSeparatedPrompt.length,
                },
            ])
        ).toEqual(['not including Vocals', 'but leave Keys soloed']);
        expect(collectClearSolosRestrictionClauses('clear all solos and retain Lead soloed')).toEqual([
            'and retain Lead soloed',
        ]);
        const leadingRestrictionPrompt = 'clear all solos while keeping Lead soloed, mute Guitar';
        expect(
            collectClearSolosRestrictionClauses(leadingRestrictionPrompt, [
                { actionType: 'clearSolos', start: 0, end: leadingRestrictionPrompt.indexOf(', mute') },
                {
                    actionType: 'muteTrack',
                    start: leadingRestrictionPrompt.indexOf('mute Guitar'),
                    end: leadingRestrictionPrompt.length,
                },
            ])
        ).toEqual(['while keeping Lead soloed']);
        expect(collectClearSolosRestrictionClauses('clear all solos and leave Keys muted, then mute Guitar')).toEqual(
            []
        );
        for (const [actionType, actionText] of [
            ['muteTrack', 'mute every track'],
            ['armTrack', 'arm every track'],
            ['soloTrack', 'solo every track'],
        ] as const) {
            const adjacentBulkPrompt = `clear all solos and ${actionText} except Vocals`;
            expect(
                collectClearSolosRestrictionClauses(adjacentBulkPrompt, [
                    { actionType: 'clearSolos', start: 0, end: adjacentBulkPrompt.indexOf(' and ') },
                    {
                        actionType,
                        start: adjacentBulkPrompt.indexOf(actionText),
                        end: adjacentBulkPrompt.length,
                    },
                ]),
                actionText
            ).toEqual([]);
        }
        expect(collectClearSolosRestrictionClauses('clear all solos but keep Vocals and Guitar soloed')).toEqual([
            'but keep Vocals and Guitar soloed',
        ]);
    });
});

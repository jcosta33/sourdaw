import { describe, expect, it } from 'vitest';

import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext, type ProjectContextTrack } from '../../../../models/ProjectContext';
import {
    commandScopeOverrideActionNames,
    commandScopeOverrideStrategyDefinitions,
    resolveCommandScopeOverride,
    type CommandScopeOverride,
    type CommandScopeOverrideActionName,
    type CommandScopeOverrideInput,
} from '../commandScopeOverrideStrategy';
import { createGroundingAdmissionStrategyRegistry } from '../createGroundingAdmissionStrategyRegistry';

function track(overrides: Partial<ProjectContextTrack> & { id: string; name: string }): ProjectContextTrack {
    return {
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        alternativeClipIds: [],
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        ...overrides,
    };
}

function context(tracks: ProjectContextTrack[]): ProjectContext {
    return {
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
        tracks,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

function resolve(overrides: Partial<CommandScopeOverrideInput> & { actionName: string }): CommandScopeOverride {
    return resolveCommandScopeOverride({
        actionOrdinal: 0,
        assertedArguments: {},
        context: context([]),
        prompt: 'do the thing',
        sameActionAssertedArguments: [],
        sameActionCallCount: 1,
        ...overrides,
    });
}

const deviceParameterContext = context([
    track({
        id: 'track-vocals',
        name: 'Vocals',
        deviceCount: 1,
        devices: [
            {
                id: 'device-compressor',
                name: 'compressor',
                type: 'builtin-compressor',
                bypassed: false,
                parameters: [
                    {
                        id: 'threshold',
                        name: 'Threshold',
                        type: 'float',
                        value: -24,
                        minValue: -60,
                        maxValue: 0,
                        unit: 'dB',
                    },
                    { id: 'makeup', name: 'Makeup', type: 'float', value: 0, minValue: 0, maxValue: 24, unit: 'dB' },
                ],
            },
        ],
    }),
]);

const DEVICE_PARAMETER_PROMPT = 'Set the Vocals compressor threshold to -18 dB, leaving makeup unchanged';

const bulkOutputContext = context([
    track({ id: 'bus-drum', name: 'Drum Bus', kind: 'bus' }),
    track({ id: 'track-kick', name: 'Kick' }),
    track({ id: 'track-snare', name: 'Snare' }),
]);

const BULK_OUTPUT_PROMPT = 'route Kick and Snare to the Drum Bus';

const bulkOutputArguments = [
    { trackId: 'track-kick', outputId: 'bus-drum' },
    { trackId: 'track-snare', outputId: 'bus-drum' },
];

const bulkInsertionContext = context([
    track({ id: 'track-drum-a', name: 'Drum A' }),
    track({ id: 'track-drum-b', name: 'Drum B' }),
]);

const BULK_INSERTION_PROMPT = 'add a compressor to every drum track';

const bulkInsertionArguments = [{ trackId: 'track-drum-a' }, { trackId: 'track-drum-b' }];

const mutedEmptyContext = context([
    track({ id: 'bus-mix', name: 'Mix Bus', kind: 'bus' }),
    track({ id: 'track-dead-a', name: 'Dead A', muted: true, vcaGroupId: null }),
    track({ id: 'track-dead-b', name: 'Dead B', muted: true, vcaGroupId: null }),
]);

const MUTED_EMPTY_PROMPT = 'delete all muted empty tracks and preserve buses and groups';

const mutedEmptyArguments = [{ trackId: 'track-dead-a' }, { trackId: 'track-dead-b' }];

const panContext = context([track({ id: 'track-kick', name: 'Kick' }), track({ id: 'track-snare', name: 'Snare' })]);

const PAN_PROMPT = 'pan Kick 30% left, pan Snare 40% right';

const panArguments = [
    { trackId: 'track-kick', pan: -0.3 },
    { trackId: 'track-snare', pan: 0.4 },
];

describe('command scope override strategies', () => {
    it('registers exactly the command scope override action names', () => {
        const registry = createGroundingAdmissionStrategyRegistry<
            CommandScopeOverrideActionName,
            Omit<CommandScopeOverrideInput, 'actionName'>,
            CommandScopeOverride
        >(
            'command scope override',
            commandScopeOverrideStrategyDefinitions,
            getExecutableAppActionGroundingCatalog(),
            commandScopeOverrideActionNames
        );

        expect([...registry.keys()]).toEqual([...commandScopeOverrideActionNames]);
    });

    it('leaves an action without a command scope override strategy unchanged', () => {
        expect(resolve({ actionName: 'muteTrack', prompt: 'mute all audio tracks' })).toEqual({ status: 'none' });
    });

    it('denies a clip fade whose named field carries no value', () => {
        expect(resolve({ actionName: 'setClipFade', prompt: 'set the clip fade in' })).toEqual({
            status: 'denied',
        });
    });

    it('leaves a clip fade with a valued named field to ordinary grounding', () => {
        expect(resolve({ actionName: 'setClipFade', prompt: 'set the clip fade in to 0.5 beats' })).toEqual({
            status: 'none',
        });
    });

    it('scopes a device parameter change to its resolved assignment', () => {
        expect(
            resolve({
                actionName: 'setDeviceParameter',
                context: deviceParameterContext,
                prompt: DEVICE_PARAMETER_PROMPT,
                sameActionAssertedArguments: [{ deviceId: 'device-compressor', paramId: 'threshold', value: -18 }],
                sameActionCallCount: 1,
            })
        ).toEqual({
            status: 'resolved',
            scope: {
                text: 'Set compressor Threshold on Vocals to -18 dB',
                masked: 'Set compressor Threshold on Vocals to -18 dB',
                directional: false,
                matchedIntentPhrase: 'set',
            },
        });
    });

    it('leaves a device parameter change without a protected parameter to ordinary grounding', () => {
        expect(
            resolve({
                actionName: 'setDeviceParameter',
                context: deviceParameterContext,
                prompt: 'Set the Vocals compressor threshold to -18 dB',
                sameActionAssertedArguments: [{ deviceId: 'device-compressor', paramId: 'threshold', value: -18 }],
                sameActionCallCount: 1,
            })
        ).toEqual({ status: 'none' });
    });

    it('scopes a directly named bus creation to its request clause', () => {
        expect(
            resolve({
                actionName: 'createBus',
                assertedArguments: { name: 'Drum Bus' },
                prompt: 'create a drum bus',
                sameActionCallCount: 1,
            })
        ).toEqual({
            status: 'resolved',
            scope: {
                start: 0,
                end: 'create a drum bus'.length,
                text: 'create a drum bus',
                masked: 'create a drum bus',
                directional: false,
                matchedIntentPhrase: 'create bus',
            },
        });
    });

    it('leaves a repeated bus creation to ordinary grounding', () => {
        expect(
            resolve({
                actionName: 'createBus',
                assertedArguments: { name: 'Drum Bus' },
                prompt: 'create a drum bus',
                sameActionCallCount: 2,
            })
        ).toEqual({ status: 'none' });
    });

    it('scopes a bulk output route to the route request', () => {
        expect(
            resolve({
                actionName: 'setTrackOutput',
                context: bulkOutputContext,
                prompt: BULK_OUTPUT_PROMPT,
                sameActionAssertedArguments: bulkOutputArguments,
                sameActionCallCount: 2,
            })
        ).toEqual({
            status: 'resolved',
            scope: {
                text: BULK_OUTPUT_PROMPT,
                masked: BULK_OUTPUT_PROMPT,
                directional: false,
                matchedIntentPhrase: 'route',
            },
        });
    });

    it('leaves a single output route to ordinary grounding', () => {
        expect(
            resolve({
                actionName: 'setTrackOutput',
                context: bulkOutputContext,
                prompt: BULK_OUTPUT_PROMPT,
                sameActionAssertedArguments: bulkOutputArguments.slice(0, 1),
                sameActionCallCount: 1,
            })
        ).toEqual({ status: 'none' });
    });

    it('scopes a bulk device insertion to the whole request', () => {
        expect(
            resolve({
                actionName: 'addDevice',
                context: bulkInsertionContext,
                prompt: BULK_INSERTION_PROMPT,
                sameActionAssertedArguments: bulkInsertionArguments,
                sameActionCallCount: 2,
            })
        ).toEqual({
            status: 'resolved',
            scope: {
                text: BULK_INSERTION_PROMPT,
                masked: BULK_INSERTION_PROMPT,
                directional: false,
                matchedIntentPhrase: 'insert device',
            },
        });
    });

    it('leaves a device insertion missing a family target to ordinary grounding', () => {
        expect(
            resolve({
                actionName: 'addDevice',
                context: bulkInsertionContext,
                prompt: 'add a compressor to Drum A',
                sameActionAssertedArguments: [{ trackId: 'track-drum-a' }],
                sameActionCallCount: 1,
            })
        ).toEqual({ status: 'none' });
    });

    it('scopes a bulk muted empty track deletion to the whole request', () => {
        expect(
            resolve({
                actionName: 'removeTrack',
                context: mutedEmptyContext,
                prompt: MUTED_EMPTY_PROMPT,
                sameActionAssertedArguments: mutedEmptyArguments,
                sameActionCallCount: 2,
            })
        ).toEqual({
            status: 'resolved',
            scope: {
                text: MUTED_EMPTY_PROMPT,
                masked: MUTED_EMPTY_PROMPT,
                directional: false,
                matchedIntentPhrase: 'delete track',
            },
        });
    });

    it('leaves a track deletion whose call count misses the target set to ordinary grounding', () => {
        expect(
            resolve({
                actionName: 'removeTrack',
                context: mutedEmptyContext,
                prompt: MUTED_EMPTY_PROMPT,
                sameActionAssertedArguments: mutedEmptyArguments.slice(0, 1),
                sameActionCallCount: 1,
            })
        ).toEqual({ status: 'none' });
    });

    it('scopes a repeated pan change to its own clause', () => {
        expect(
            resolve({
                actionName: 'setTrackPan',
                actionOrdinal: 1,
                context: panContext,
                prompt: PAN_PROMPT,
                sameActionAssertedArguments: panArguments,
                sameActionCallCount: 2,
            })
        ).toEqual({
            status: 'resolved',
            scope: {
                start: 'pan Kick 30% left,'.length,
                end: PAN_PROMPT.length,
                text: ' pan Snare 40% right',
                masked: ' pan □□□□□ 40% right',
                directional: false,
                matchedIntentPhrase: 'pan',
            },
        });
    });

    it('leaves a single pan change to ordinary grounding', () => {
        expect(
            resolve({
                actionName: 'setTrackPan',
                context: panContext,
                prompt: 'pan Kick 30% left',
                sameActionAssertedArguments: panArguments.slice(0, 1),
                sameActionCallCount: 1,
            })
        ).toEqual({ status: 'none' });
    });
});

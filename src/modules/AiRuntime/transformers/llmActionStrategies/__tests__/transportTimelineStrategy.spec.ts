import { describe, expect, it } from 'vitest';

import { createPunchRegionPatch } from '#/modules/Transport/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';
import { type RuntimeAction } from '../../../models/RuntimeAction';
import {
    bridgeTransportTimelineToolCall,
    createLlmActionStrategyRegistry,
    transportTimelineStrategyRegistry,
    type TransportTimelineCallName,
} from '../transportTimelineStrategy';

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
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

type ExactKeyGuardCase<Name extends TransportTimelineCallName> = {
    [StrategyName in Name]: {
        action: Extract<RuntimeAction, { type: StrategyName }>;
        arguments: Record<string, unknown>;
        name: StrategyName;
        reason: string;
    };
}[Name];

const exactKeyGuardCases = [
    {
        action: { type: 'setTempo', payload: { bpm: 128 } },
        arguments: { bpm: 128 },
        name: 'setTempo',
        reason: 'Expected only a finite bpm from 20 through 300',
    },
    {
        action: { type: 'setTimeSignature', payload: { numerator: 3, denominator: 4 } },
        arguments: { numerator: 3, denominator: 4 },
        name: 'setTimeSignature',
        reason: 'Expected an integer numerator from 1 through 32 and denominator 2, 4, 8, or 16',
    },
    {
        action: { type: 'setPlayback', payload: { playing: true } },
        arguments: { playing: true },
        name: 'setPlayback',
        reason: 'Expected only a boolean playing value',
    },
    {
        action: { type: 'stopPlayback' },
        arguments: {},
        name: 'stopPlayback',
        reason: 'Expected no arguments',
    },
    {
        action: { type: 'seekPlayhead', payload: { beat: 4 } },
        arguments: { beat: 4 },
        name: 'seekPlayhead',
        reason: 'Expected only a changed finite beat greater than or equal to 0',
    },
    {
        action: { type: 'setLoopEnabled', payload: { enabled: true } },
        arguments: { enabled: true },
        name: 'setLoopEnabled',
        reason: 'Expected a boolean enabled value and a valid existing loop region',
    },
    {
        action: { type: 'setLoopRegion', payload: { startBeat: 4, endBeat: 8 } },
        arguments: { startBeat: 4, endBeat: 8 },
        name: 'setLoopRegion',
        reason: 'Expected finite loop beats with 0 <= startBeat < endBeat',
    },
    {
        action: { type: 'setPunchIn', payload: { beat: 4 } },
        arguments: { beat: 4 },
        name: 'setPunchIn',
        reason: 'Expected exactly one finite punch-in beat with 0 <= beat < Number.MAX_VALUE',
    },
    {
        action: { type: 'setPunchOut', payload: { beat: 12 } },
        arguments: { beat: 12 },
        name: 'setPunchOut',
        reason: 'Expected exactly one finite punch-out beat with 0 < beat <= Number.MAX_VALUE',
    },
    {
        action: { type: 'setPunchEnabled', payload: { enabled: true } },
        arguments: { enabled: true },
        name: 'setPunchEnabled',
        reason: 'Expected only a boolean enabled value',
    },
    {
        action: { type: 'setMetronomeEnabled', payload: { enabled: true } },
        arguments: { enabled: true },
        name: 'setMetronomeEnabled',
        reason: 'Expected only a boolean enabled value',
    },
    {
        action: { type: 'setMetronomeVolume', payload: { volume: 0.25 } },
        arguments: { volume: 0.25 },
        name: 'setMetronomeVolume',
        reason: 'Expected only a finite metronome volume from 0 through 1',
    },
] as const satisfies readonly ExactKeyGuardCase<TransportTimelineCallName>[];

type ExactKeyGuardCaseName = (typeof exactKeyGuardCases)[number]['name'];
type AllExactKeyGuardsCovered = Exclude<TransportTimelineCallName, ExactKeyGuardCaseName> extends never ? true : never;

function assertAllExactKeyGuardsCovered(
    cases: AllExactKeyGuardsCovered extends true ? typeof exactKeyGuardCases : never
): typeof exactKeyGuardCases {
    return cases;
}

type PunchCallName = Extract<TransportTimelineCallName, 'setPunchIn' | 'setPunchOut'>;

type PunchCallCase<Name extends PunchCallName> = {
    [CallName in Name]: {
        arguments: Record<string, unknown>;
        endpointReason: string;
        name: CallName;
    };
}[Name];

const punchCallCases = [
    {
        arguments: { beat: 4 },
        endpointReason: 'Expected exactly one finite punch-in beat with 0 <= beat < Number.MAX_VALUE',
        name: 'setPunchIn',
    },
    {
        arguments: { beat: 12 },
        endpointReason: 'Expected exactly one finite punch-out beat with 0 < beat <= Number.MAX_VALUE',
        name: 'setPunchOut',
    },
] as const satisfies readonly PunchCallCase<PunchCallName>[];

const invalidPunchRegionContexts = [
    { context: { ...projectContext, punchInBeat: Number.NaN }, label: 'non-finite punch-in beat' },
    { context: { ...projectContext, punchOutBeat: Number.NaN }, label: 'non-finite punch-out beat' },
    { context: { ...projectContext, punchInBeat: -1 }, label: 'negative punch-in beat' },
    { context: { ...projectContext, punchInBeat: 8, punchOutBeat: 4 }, label: 'punch-out at or before punch-in' },
] satisfies readonly { context: ProjectContext; label: string }[];

function bridgePunchCall({
    arguments: callArguments,
    context,
    name,
    projectPunchRegion,
}: {
    arguments: Record<string, unknown>;
    context: ProjectContext;
    name: PunchCallName;
    projectPunchRegion: typeof createPunchRegionPatch;
}) {
    return bridgeTransportTimelineToolCall({
        call: { name, arguments: callArguments },
        context,
        index: 0,
        projectPunchRegion,
    });
}

type BooleanNoOpCallName = Extract<TransportTimelineCallName, 'setPlayback' | 'setPunchEnabled'>;

type BooleanNoOpCase<Name extends BooleanNoOpCallName> = {
    [CallName in Name]: {
        arguments: Record<string, unknown>;
        context: ProjectContext;
        name: CallName;
        reason: string;
    };
}[Name];

const booleanNoOpCases = [
    {
        arguments: { enabled: false },
        context: { ...projectContext, punchInEnabled: false },
        name: 'setPunchEnabled',
        reason: 'Requested Transport Punch In/Out state already matches project state',
    },
    {
        arguments: { enabled: true },
        context: { ...projectContext, punchInEnabled: true },
        name: 'setPunchEnabled',
        reason: 'Requested Transport Punch In/Out state already matches project state',
    },
    {
        arguments: { playing: false },
        context: { ...projectContext, isPlaying: false },
        name: 'setPlayback',
        reason: 'Requested playback state already matches the current transport state',
    },
    {
        arguments: { playing: true },
        context: { ...projectContext, isPlaying: true },
        name: 'setPlayback',
        reason: 'Requested playback state already matches the current transport state',
    },
] as const satisfies readonly BooleanNoOpCase<BooleanNoOpCallName>[];

const activePunchTransportContexts = [
    { context: { ...projectContext, isPlaying: true }, label: 'playing' },
    { context: { ...projectContext, isRecording: true }, label: 'recording' },
] satisfies readonly { context: ProjectContext; label: string }[];

describe('transportTimelineStrategy', () => {
    it('registers the complete transport and timeline family exactly once', () => {
        expect([...transportTimelineStrategyRegistry.keys()]).toEqual([
            'setTempo',
            'setTimeSignature',
            'setPlayback',
            'stopPlayback',
            'seekPlayhead',
            'setLoopEnabled',
            'setLoopRegion',
            'setPunchIn',
            'setPunchOut',
            'setPunchEnabled',
            'setMetronomeEnabled',
            'setMetronomeVolume',
        ]);
    });

    it('rejects duplicate strategy names', () => {
        expect(() =>
            createLlmActionStrategyRegistry([
                { name: 'setTempo', transform: () => ({ type: 'setTempo', payload: { bpm: 120 } }) },
                { name: 'setTempo', transform: () => ({ type: 'setTempo', payload: { bpm: 128 } }) },
            ])
        ).toThrow('Duplicate LLM action strategy: setTempo');
    });

    it('delegates registered calls and leaves legacy calls for the bridge', () => {
        const input = {
            context: projectContext,
            index: 0,
            projectPunchRegion: createPunchRegionPatch,
        };

        expect(
            bridgeTransportTimelineToolCall({
                ...input,
                call: { name: 'setTempo', arguments: { bpm: 128 } },
            })
        ).toEqual({ type: 'setTempo', payload: { bpm: 128 } });
        expect(
            bridgeTransportTimelineToolCall({
                ...input,
                call: { name: 'setMasterGain', arguments: { gain: 0.9 } },
            })
        ).toBeNull();
    });

    it('rejects extra fields for every transport and timeline strategy', () => {
        for (const testCase of assertAllExactKeyGuardsCovered(exactKeyGuardCases)) {
            const input = {
                context: projectContext,
                index: 0,
                projectPunchRegion: createPunchRegionPatch,
            };

            expect(
                bridgeTransportTimelineToolCall({
                    ...input,
                    call: { name: testCase.name, arguments: testCase.arguments },
                })
            ).toEqual(testCase.action);
            expect(
                bridgeTransportTimelineToolCall({
                    ...input,
                    call: { name: testCase.name, arguments: { ...testCase.arguments, unexpected: true } },
                })
            ).toEqual({ index: 0, name: testCase.name, reason: testCase.reason });
        }
    });

    it('rejects invalid punch regions before calling the projector', () => {
        for (const invalidRegion of invalidPunchRegionContexts) {
            for (const testCase of punchCallCases) {
                let projectorCalls = 0;
                const projectPunchRegion: typeof createPunchRegionPatch = () => {
                    projectorCalls += 1;
                    return null;
                };

                expect(
                    bridgePunchCall({
                        ...testCase,
                        context: invalidRegion.context,
                        projectPunchRegion,
                    })
                ).toEqual({ index: 0, name: testCase.name, reason: testCase.endpointReason });
                expect(projectorCalls, invalidRegion.label).toBe(0);
            }
        }
    });

    it('rejects punch endpoints when the projector cannot produce a region', () => {
        for (const testCase of punchCallCases) {
            const projectPunchRegion: typeof createPunchRegionPatch = () => null;

            expect(bridgePunchCall({ ...testCase, context: projectContext, projectPunchRegion })).toEqual({
                index: 0,
                name: testCase.name,
                reason: 'Requested punch endpoint cannot produce a finite punch region',
            });
        }
    });

    it('rejects punch endpoints when the projector leaves the region unchanged', () => {
        for (const testCase of punchCallCases) {
            const projectPunchRegion: typeof createPunchRegionPatch = ({ current }) => ({ ...current });

            expect(bridgePunchCall({ ...testCase, context: projectContext, projectPunchRegion })).toEqual({
                index: 0,
                name: testCase.name,
                reason: 'Requested punch endpoint already matches project state',
            });
        }
    });

    it('rejects both boolean no-op polarities for playback and punch enablement', () => {
        for (const testCase of booleanNoOpCases) {
            expect(
                bridgeTransportTimelineToolCall({
                    call: { name: testCase.name, arguments: testCase.arguments },
                    context: testCase.context,
                    index: 0,
                    projectPunchRegion: createPunchRegionPatch,
                })
            ).toEqual({ index: 0, name: testCase.name, reason: testCase.reason });
        }
    });

    it('rejects punch enablement while either playback or recording is active', () => {
        for (const activeTransport of activePunchTransportContexts) {
            expect(
                bridgeTransportTimelineToolCall({
                    call: { name: 'setPunchEnabled', arguments: { enabled: true } },
                    context: activeTransport.context,
                    index: 0,
                    projectPunchRegion: createPunchRegionPatch,
                })
            ).toEqual({
                index: 0,
                name: 'setPunchEnabled',
                reason: 'Transport Punch In/Out can change only while transport is stopped',
            });
        }
    });
});

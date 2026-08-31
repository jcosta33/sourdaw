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

type ValuePredicateCase<Name extends TransportTimelineCallName> = {
    [CallName in Name]: {
        call: { arguments: Record<string, unknown>; name: CallName };
        context: ProjectContext;
        expected: Extract<RuntimeAction, { type: CallName }> | { index: number; name: CallName; reason: string };
        label: string;
    };
}[Name];

const valuePredicateCases = [
    {
        call: { arguments: { bpm: 20 }, name: 'setTempo' },
        context: projectContext,
        expected: { type: 'setTempo', payload: { bpm: 20 } },
        label: 'tempo accepts its lower bound',
    },
    {
        call: { arguments: { bpm: 300 }, name: 'setTempo' },
        context: projectContext,
        expected: { type: 'setTempo', payload: { bpm: 300 } },
        label: 'tempo accepts its upper bound',
    },
    {
        call: { arguments: { bpm: Number.NaN }, name: 'setTempo' },
        context: projectContext,
        expected: { index: 0, name: 'setTempo', reason: 'Expected only a finite bpm from 20 through 300' },
        label: 'tempo rejects non-finite values',
    },
    {
        call: { arguments: { bpm: 19 }, name: 'setTempo' },
        context: projectContext,
        expected: { index: 0, name: 'setTempo', reason: 'Expected only a finite bpm from 20 through 300' },
        label: 'tempo rejects values below its lower bound',
    },
    {
        call: { arguments: { bpm: 301 }, name: 'setTempo' },
        context: projectContext,
        expected: { index: 0, name: 'setTempo', reason: 'Expected only a finite bpm from 20 through 300' },
        label: 'tempo rejects values above its upper bound',
    },
    {
        call: { arguments: { numerator: 1, denominator: 2 }, name: 'setTimeSignature' },
        context: projectContext,
        expected: { type: 'setTimeSignature', payload: { numerator: 1, denominator: 2 } },
        label: 'time signature accepts its lower numerator and denominator edge',
    },
    {
        call: { arguments: { numerator: 32, denominator: 16 }, name: 'setTimeSignature' },
        context: projectContext,
        expected: { type: 'setTimeSignature', payload: { numerator: 32, denominator: 16 } },
        label: 'time signature accepts its upper numerator and denominator edge',
    },
    {
        call: { arguments: { numerator: Number.NaN, denominator: 4 }, name: 'setTimeSignature' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setTimeSignature',
            reason: 'Expected an integer numerator from 1 through 32 and denominator 2, 4, 8, or 16',
        },
        label: 'time signature rejects non-finite numerators',
    },
    {
        call: { arguments: { numerator: 1.5, denominator: 4 }, name: 'setTimeSignature' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setTimeSignature',
            reason: 'Expected an integer numerator from 1 through 32 and denominator 2, 4, 8, or 16',
        },
        label: 'time signature rejects fractional numerators',
    },
    {
        call: { arguments: { numerator: 0, denominator: 4 }, name: 'setTimeSignature' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setTimeSignature',
            reason: 'Expected an integer numerator from 1 through 32 and denominator 2, 4, 8, or 16',
        },
        label: 'time signature rejects numerators below its lower bound',
    },
    {
        call: { arguments: { numerator: 33, denominator: 4 }, name: 'setTimeSignature' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setTimeSignature',
            reason: 'Expected an integer numerator from 1 through 32 and denominator 2, 4, 8, or 16',
        },
        label: 'time signature rejects numerators above its upper bound',
    },
    {
        call: { arguments: { numerator: 4, denominator: 3 }, name: 'setTimeSignature' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setTimeSignature',
            reason: 'Expected an integer numerator from 1 through 32 and denominator 2, 4, 8, or 16',
        },
        label: 'time signature rejects unsupported denominators',
    },
    {
        call: { arguments: { playing: 'true' }, name: 'setPlayback' },
        context: projectContext,
        expected: { index: 0, name: 'setPlayback', reason: 'Expected only a boolean playing value' },
        label: 'playback rejects non-boolean values',
    },
    {
        call: { arguments: { beat: Number.NaN }, name: 'seekPlayhead' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'seekPlayhead',
            reason: 'Expected only a changed finite beat greater than or equal to 0',
        },
        label: 'seek rejects non-finite beats',
    },
    {
        call: { arguments: { beat: Number.POSITIVE_INFINITY }, name: 'seekPlayhead' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'seekPlayhead',
            reason: 'Expected only a changed finite beat greater than or equal to 0',
        },
        label: 'seek rejects positive infinity',
    },
    {
        call: { arguments: { beat: -1 }, name: 'seekPlayhead' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'seekPlayhead',
            reason: 'Expected only a changed finite beat greater than or equal to 0',
        },
        label: 'seek rejects negative beats',
    },
    {
        call: { arguments: { beat: 0 }, name: 'seekPlayhead' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'seekPlayhead',
            reason: 'Expected only a changed finite beat greater than or equal to 0',
        },
        label: 'seek rejects unchanged beats',
    },
    {
        call: { arguments: { enabled: 'true' }, name: 'setLoopEnabled' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setLoopEnabled',
            reason: 'Expected a boolean enabled value and a valid existing loop region',
        },
        label: 'loop enablement rejects non-boolean values',
    },
    {
        call: { arguments: { enabled: true }, name: 'setLoopEnabled' },
        context: { ...projectContext, loopStart: 8, loopEnd: 8 },
        expected: {
            index: 0,
            name: 'setLoopEnabled',
            reason: 'Expected a boolean enabled value and a valid existing loop region',
        },
        label: 'loop enablement rejects invalid regions',
    },
    {
        call: { arguments: { enabled: false }, name: 'setLoopEnabled' },
        context: { ...projectContext, loopStart: 8, loopEnd: 8 },
        expected: { type: 'setLoopEnabled', payload: { enabled: false } },
        label: 'loop disablement accepts an invalid existing region',
    },
    {
        call: { arguments: { startBeat: Number.NaN, endBeat: 8 }, name: 'setLoopRegion' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setLoopRegion',
            reason: 'Expected finite loop beats with 0 <= startBeat < endBeat',
        },
        label: 'loop regions reject non-finite starts',
    },
    {
        call: { arguments: { startBeat: 4, endBeat: Number.POSITIVE_INFINITY }, name: 'setLoopRegion' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setLoopRegion',
            reason: 'Expected finite loop beats with 0 <= startBeat < endBeat',
        },
        label: 'loop regions reject non-finite ends',
    },
    {
        call: { arguments: { startBeat: -1, endBeat: 8 }, name: 'setLoopRegion' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setLoopRegion',
            reason: 'Expected finite loop beats with 0 <= startBeat < endBeat',
        },
        label: 'loop regions reject negative starts',
    },
    {
        call: { arguments: { startBeat: 4, endBeat: 4 }, name: 'setLoopRegion' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setLoopRegion',
            reason: 'Expected finite loop beats with 0 <= startBeat < endBeat',
        },
        label: 'loop regions reject collapsed ranges',
    },
    {
        call: { arguments: { startBeat: 8, endBeat: 4 }, name: 'setLoopRegion' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setLoopRegion',
            reason: 'Expected finite loop beats with 0 <= startBeat < endBeat',
        },
        label: 'loop regions reject reversed ranges',
    },
    {
        call: { arguments: { beat: Number.NaN }, name: 'setPunchIn' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setPunchIn',
            reason: 'Expected exactly one finite punch-in beat with 0 <= beat < Number.MAX_VALUE',
        },
        label: 'punch-in rejects non-finite beats',
    },
    {
        call: { arguments: { beat: -1 }, name: 'setPunchIn' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setPunchIn',
            reason: 'Expected exactly one finite punch-in beat with 0 <= beat < Number.MAX_VALUE',
        },
        label: 'punch-in rejects beats below zero',
    },
    {
        call: { arguments: { beat: Number.MAX_VALUE }, name: 'setPunchIn' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setPunchIn',
            reason: 'Expected exactly one finite punch-in beat with 0 <= beat < Number.MAX_VALUE',
        },
        label: 'punch-in rejects its exclusive upper bound',
    },
    {
        call: { arguments: { beat: 0 }, name: 'setPunchIn' },
        context: { ...projectContext, punchInBeat: 1 },
        expected: { type: 'setPunchIn', payload: { beat: 0 } },
        label: 'punch-in accepts zero',
    },
    {
        call: { arguments: { beat: Number.NaN }, name: 'setPunchOut' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setPunchOut',
            reason: 'Expected exactly one finite punch-out beat with 0 < beat <= Number.MAX_VALUE',
        },
        label: 'punch-out rejects non-finite beats',
    },
    {
        call: { arguments: { beat: 0 }, name: 'setPunchOut' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setPunchOut',
            reason: 'Expected exactly one finite punch-out beat with 0 < beat <= Number.MAX_VALUE',
        },
        label: 'punch-out rejects zero',
    },
    {
        call: { arguments: { beat: Number.MAX_VALUE }, name: 'setPunchOut' },
        context: projectContext,
        expected: { type: 'setPunchOut', payload: { beat: Number.MAX_VALUE } },
        label: 'punch-out accepts its upper bound',
    },
    {
        call: { arguments: { enabled: 'true' }, name: 'setPunchEnabled' },
        context: projectContext,
        expected: { index: 0, name: 'setPunchEnabled', reason: 'Expected only a boolean enabled value' },
        label: 'punch enablement rejects non-boolean values',
    },
    {
        call: { arguments: { enabled: 'true' }, name: 'setMetronomeEnabled' },
        context: projectContext,
        expected: { index: 0, name: 'setMetronomeEnabled', reason: 'Expected only a boolean enabled value' },
        label: 'metronome enablement rejects non-boolean values',
    },
    {
        call: { arguments: { enabled: false }, name: 'setMetronomeEnabled' },
        context: projectContext,
        expected: { type: 'setMetronomeEnabled', payload: { enabled: false } },
        label: 'metronome disablement preserves false in the payload',
    },
    {
        call: { arguments: { volume: 0 }, name: 'setMetronomeVolume' },
        context: projectContext,
        expected: { type: 'setMetronomeVolume', payload: { volume: 0 } },
        label: 'metronome volume accepts zero',
    },
    {
        call: { arguments: { volume: 1 }, name: 'setMetronomeVolume' },
        context: projectContext,
        expected: { type: 'setMetronomeVolume', payload: { volume: 1 } },
        label: 'metronome volume accepts one',
    },
    {
        call: { arguments: { volume: Number.NaN }, name: 'setMetronomeVolume' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setMetronomeVolume',
            reason: 'Expected only a finite metronome volume from 0 through 1',
        },
        label: 'metronome volume rejects non-finite values',
    },
    {
        call: { arguments: { volume: '0.5' }, name: 'setMetronomeVolume' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setMetronomeVolume',
            reason: 'Expected only a finite metronome volume from 0 through 1',
        },
        label: 'metronome volume rejects numeric strings',
    },
    {
        call: { arguments: { volume: -0.1 }, name: 'setMetronomeVolume' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setMetronomeVolume',
            reason: 'Expected only a finite metronome volume from 0 through 1',
        },
        label: 'metronome volume rejects values below zero',
    },
    {
        call: { arguments: { volume: 1.1 }, name: 'setMetronomeVolume' },
        context: projectContext,
        expected: {
            index: 0,
            name: 'setMetronomeVolume',
            reason: 'Expected only a finite metronome volume from 0 through 1',
        },
        label: 'metronome volume rejects values above one',
    },
] as const satisfies readonly ValuePredicateCase<TransportTimelineCallName>[];

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

    it('preserves the supplied index when rejecting an invalid call', () => {
        expect(
            bridgeTransportTimelineToolCall({
                call: { name: 'setTempo', arguments: { bpm: 301 } },
                context: projectContext,
                index: 7,
                projectPunchRegion: createPunchRegionPatch,
            })
        ).toEqual({ index: 7, name: 'setTempo', reason: 'Expected only a finite bpm from 20 through 300' });
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

    it('preserves every remaining transport and timeline value predicate', () => {
        for (const testCase of valuePredicateCases) {
            expect(
                bridgeTransportTimelineToolCall({
                    call: testCase.call,
                    context: testCase.context,
                    index: 0,
                    projectPunchRegion: createPunchRegionPatch,
                })
            ).toEqual(testCase.expected);
        }
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { commandTrackDefaultsPort, parseVersionedCommandEnvelope } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';

vi.mock('../llmOrchestration/inference', async (importOriginal) => {
    const original = await importOriginal<typeof import('../llmOrchestration/inference')>();
    return {
        ...original,
        generateToolPlanningOutcome: vi.fn(original.generateToolPlanningOutcome),
    };
});

function createContext(): ProjectContext {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 16,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 16,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        masterGain: 1,
        activeView: 'arrange',
        playheadPosition: 0,
        selectedTrackId: 'track-bass',
        selectedClipId: 'clip-bass',
        selectedClipIds: ['clip-bass'],
        tracks: [
            {
                id: 'track-bass',
                name: 'Bass',
                kind: 'audio',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                frozen: false,
                gain: 0.8,
                pan: 0,
                automationMode: 'read',
                outputId: 'master',
                clipCount: 1,
                deviceCount: 0,
                clips: [
                    {
                        id: 'clip-bass',
                        name: 'Bass Verse',
                        type: 'audio',
                        startBeat: 0,
                        endBeat: 8,
                        noteCount: 0,
                    },
                ],
                devices: [],
                sends: [],
            },
        ],
    };
}

function createDuplicateBassContext(): ProjectContext {
    const context = createContext();
    return {
        ...context,
        tracks: [context.tracks[0]!, { ...context.tracks[0]!, id: 'track-bass-copy', clips: [], clipCount: 0 }],
    };
}

function providerClarification() {
    return {
        status: 'complete' as const,
        toolCalls: [
            {
                name: 'command.batch.decline',
                arguments: {
                    kind: 'clarify',
                    reason: 'The whole request needs semantic planning.',
                    questions: ['How should the complete request be carried out?'],
                },
            },
        ],
    };
}

describe('whole-request prompt interpretation routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(generateToolPlanningOutcome).mockResolvedValue(providerClarification());
    });

    afterEach(() => {
        clearHandlerRegistry();
        commandTrackDefaultsPort.setTrackColorProvider(null);
        vi.restoreAllMocks();
    });

    it.each([
        ['play', 'setPlayback'],
        ['start playback', 'setPlayback'],
        ['stop', 'stopPlayback'],
        ['set tempo to 128', 'setTempo'],
        ['volume 1%', 'setTrackGain'],
        ['set volume to 1', 'setTrackGain'],
        ['set pan to -25', 'setTrackPan'],
        ['add compressor to Bass track', 'addDevice'],
        ['add eq and compressor to selected track', 'addDevice'],
        ['create 2 midi tracks named "Bass, DI", "Keys and Pads"', 'addTrack'],
        ['rename clip to Bridge Solo', 'renameClip'],
        ['rename clip to "Bridge And Solo"', 'renameClip'],
        ['join session invite-ABC', 'joinCollabSession'],
    ])('keeps the complete explicit command %s on the deterministic route', async (prompt, actionType) => {
        const context = createContext();
        const snapshot = structuredClone(context);

        const result = await parsePromptToActions(prompt, context);

        expect(result.actions[0]?.type).toBe(actionType);
        expect(result.planningOutcome).toEqual({ kind: 'proposal' });
        expect(generateToolPlanningOutcome).not.toHaveBeenCalled();
        expect(context).toEqual(snapshot);
    });

    it('validates and compiles a deterministic proposal without mutating project context', async () => {
        const context = createContext();
        const snapshot = structuredClone(context);
        const prompt = 'create 2 audio tracks named Lead Vocals, Backing Vocals';

        const result = await parsePromptToActions(prompt, context, undefined, 'revision-routing');

        commandTrackDefaultsPort.setTrackColorProvider(() => 'oklch(0.40 0.08 250)');
        registerHandlerMap(getArrangementHandlers());
        const compiled = compilePlannedActionCommandBatch({
            actions: result.actions,
            actionLabels: result.actions.map((action) => action.type),
            autoCommit: false,
            context,
            group: { groupId: 'routing-proof', groupLabel: 'Routing proof' },
            intent: prompt,
            projectRevision: 'revision-routing',
            runId: 'run-routing-proof',
        });
        const parsed = compiled.commandEnvelopes.map((serialized) => parseVersionedCommandEnvelope(serialized));
        for (const command of parsed) {
            if (command.status === 'invalid') {
                throw new Error(command.reason);
            }
        }

        expect(result.actions).toMatchObject([
            { type: 'addTrack', payload: { name: 'Lead Vocals', kind: 'audio' } },
            { type: 'addTrack', payload: { name: 'Backing Vocals', kind: 'audio' } },
        ]);
        expect(parsed).toHaveLength(2);
        expect(parsed).toEqual([
            expect.objectContaining({
                status: 'valid',
                envelope: expect.objectContaining({
                    normalizedProjectRevision: 'revision-routing',
                    operation: 'addTrack',
                    arguments: expect.objectContaining({ name: 'Lead Vocals' }),
                    applicationAssignedIds: expect.arrayContaining([
                        expect.objectContaining({ argument: 'id', value: expect.any(String) }),
                    ]),
                }),
            }),
            expect.objectContaining({
                status: 'valid',
                envelope: expect.objectContaining({
                    normalizedProjectRevision: 'revision-routing',
                    operation: 'addTrack',
                    arguments: expect.objectContaining({ name: 'Backing Vocals' }),
                    applicationAssignedIds: expect.arrayContaining([
                        expect.objectContaining({ argument: 'id', value: expect.any(String) }),
                    ]),
                }),
            }),
        ]);
        expect(generateToolPlanningOutcome).not.toHaveBeenCalled();
        expect(context).toEqual(snapshot);
    });

    it('keeps the full deterministic creation ceiling outside the provider batch limit', async () => {
        const result = await parsePromptToActions('create 32 audio tracks', createContext());

        expect(result.actions).toHaveLength(32);
        expect(result.actions[0]).toMatchObject({ type: 'addTrack', payload: { name: 'Audio 1', kind: 'audio' } });
        expect(result.actions[31]).toMatchObject({ type: 'addTrack', payload: { name: 'Audio 32', kind: 'audio' } });
        expect(generateToolPlanningOutcome).not.toHaveBeenCalled();
    });

    it('preserves prior numeric and opaque-value semantics with every interpreter active', async () => {
        const context = createContext();

        const onePercent = await parsePromptToActions('volume 1%', context);
        const bareOne = await parsePromptToActions('set volume to 1', context);
        const unquotedRename = await parsePromptToActions('rename clip to Bridge Solo', context);
        const quotedRename = await parsePromptToActions('rename clip to "Bridge And Solo"', context);

        expect(onePercent.actions[0]?.payload).toMatchObject({ trackId: 'track-bass', gain: 0.01 });
        expect(bareOne.actions[0]?.payload).toMatchObject({ trackId: 'track-bass', gain: 1 });
        expect(unquotedRename.actions[0]?.payload).toMatchObject({ clipId: 'clip-bass', name: 'Bridge Solo' });
        expect(quotedRename.actions[0]?.payload).toMatchObject({
            clipId: 'clip-bass',
            name: 'Bridge And Solo',
        });
        expect(generateToolPlanningOutcome).not.toHaveBeenCalled();
    });

    it('rejects an invalid explicit numeric value truthfully without changing or semantically rerouting it', async () => {
        const context = createContext();

        const result = await parsePromptToActions('set pan to 100', context);

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBe('Recognized command failed runtime validation: setTrackPan');
        expect(generateToolPlanningOutcome).not.toHaveBeenCalled();
    });

    it.each([
        ['make it warmer', createContext],
        ['make it warm then mute Bass', createContext],
        ['make it warm without adding devices', createContext],
        ['add a bluesy sounding piano and melody', createContext],
        ['create 2 tracks named Bass, Keys then mute Bass', createContext],
        ['create 33 audio tracks', createContext],
        ['copy clip', createContext],
        ['mute Bass', createDuplicateBassContext],
    ])(
        'sends the complete unresolved request %s to one provider turn without returning a prefix',
        async (prompt, makeContext) => {
            const result = await parsePromptToActions(prompt, makeContext());

            expect(result.actions).toEqual([]);
            expect(result.planningOutcome).toEqual({
                kind: 'clarify',
                reason: 'The whole request needs semantic planning.',
                questions: ['How should the complete request be carried out?'],
            });
            expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(1);
            expect(vi.mocked(generateToolPlanningOutcome).mock.calls[0]?.[4]).toBe(prompt);
        }
    );
});

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { llmStatusStore } from '#/modules/AiRuntime/stores';
import { type describePlannedAction } from '#/modules/AiRuntime/useCases';
import {
    compilePlannedActionCommandBatch,
    executePlannedActions,
    getProjectContext,
    parsePromptToActions,
    planPromptActions,
    isComplexPrompt,
    searchPresets,
    getAvailablePresets,
    resolvePresetActions,
    onPromptInjection,
    notifyAiChange,
    isLlmAvailable,
    initEngine,
} from '#/modules/AiRuntime/useCases';
import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { requiresAppActionConfirmation } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { usePromptExecution } from '../usePromptExecution';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('#/infra/store/useStore', () => ({ useStore: vi.fn() }));
vi.mock('#/modules/AiRuntime/stores', () => ({ llmStatusStore: { value: { state: 'idle' } } }));
vi.mock('#/modules/AiRuntime/useCases', () => ({
    compilePlannedActionCommandBatch: vi.fn(() => ({
        commandEnvelopes: ['command-envelope'],
        commandBatch: {
            serialized: 'command-batch',
            authority: {
                projectId: 'project-1',
                baseRevision: 'revision-1',
                scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                grants: {
                    allowedOperationPrefixes: ['togglePlayback'],
                    create: false,
                    delete: false,
                    routing: false,
                    tempo: false,
                    master: false,
                    file: false,
                    audioUpload: false,
                    remoteGeneration: false,
                    autoCommit: true,
                },
                budgets: {
                    maxCommands: 1,
                    maxCreatedTracks: 0,
                    maxDeletedObjects: 0,
                    maxAffectedTracks: 0,
                    maxAffectedClips: 0,
                    maxAutomationPoints: 0,
                    maxImportedAssets: 0,
                    maxRenderJobs: 0,
                },
            },
        },
    })),
    executePlannedActions: vi.fn(),
    describePlannedAction: vi.fn((input: Parameters<typeof describePlannedAction>[0]) => {
        const action = input.action;
        if (action.type === 'removeTrack') {
            const trackId = action.payload.trackId;
            const track = input.context.tracks.find((candidate) => candidate.id === trackId);
            if (track) {
                return `Remove track "${track.name}"`;
            }
        }
        return action.type;
    }),
    planPromptActions: vi.fn(),
    parsePromptToActions: vi.fn().mockResolvedValue({ actions: [], rawText: '', requiresConfirmation: false }),
    isComplexPrompt: vi.fn(() => false),
    getProjectContext: vi.fn(() => ({})),
    searchPresets: vi.fn(() => []),
    getAvailablePresets: vi.fn(() => []),
    resolvePresetActions: vi.fn(() => []),
    onPromptInjection: vi.fn(() => () => {}),
    notifyAiChange: vi.fn(),
    isLlmAvailable: vi.fn(() => false),
    initEngine: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: null },
    clipSelectionStore: { value: null },
    defaultTrackState: { tracks: [], selectedTrackId: null },
    defaultClipSelectionState: { selectedClipId: null, selectedClipIds: [], marqueeSelection: null },
}));
vi.mock('#/modules/Command/useCases', () => ({
    describeAction: vi.fn((action: { type: string }) => action.type),
    generateGroupId: vi.fn(() => ({ groupId: 'group-1', groupLabel: 'Prompt action' })),
    isExecutableAppActionType: vi.fn((type: string) => type !== 'removeAllTracks'),
    requiresAppActionConfirmation: vi.fn(() => false),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: vi.fn(() => 'revision-1'),
}));

type Preset = { id: string; label: string; category: 'Transport' | 'Track'; isDestructive: boolean };
const preset = (overrides: Partial<Preset> = {}): Preset => ({
    id: 'play',
    label: 'Play',
    category: 'Transport',
    isDestructive: false,
    ...overrides,
});
const fuzzy = (p: Preset): { preset: Preset; score: number } => ({ preset: p, score: 1 });
const formEvent = { preventDefault: vi.fn() };

let trackState: {
    tracks: Array<{ id: string; name: string; clips: Array<{ id: string; name: string; type: string }> }>;
    selectedTrackId: string | null;
};
let clipState: { selectedClipId: string | null; selectedClipIds: string[]; marqueeSelection: null };

vi.mocked(useStore).mockImplementation((store: unknown, fallback: unknown) => {
    if (store === trackStore) {
        return trackState;
    }
    if (store === clipSelectionStore) {
        return clipState;
    }
    if (store === llmStatusStore) {
        return { state: 'idle' };
    }
    return fallback;
});

describe('usePromptExecution', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackState = { tracks: [], selectedTrackId: null };
        clipState = { selectedClipId: null, selectedClipIds: [], marqueeSelection: null };
        // clearAllMocks resets call history but not implementations, so tests
        // that persist a custom mockReturnValue/mockResolvedValue must be
        // re-defaulted here rather than leaking into the next test.
        vi.mocked(parsePromptToActions).mockResolvedValue({ actions: [], rawText: '', requiresConfirmation: false });
        vi.mocked(planPromptActions).mockImplementation(async (input) => {
            const context = getProjectContext();
            return {
                context,
                result: await parsePromptToActions(input.prompt, context, input.signal),
                projectRevision: 'revision-1',
            };
        });
        vi.mocked(executePlannedActions).mockImplementation((input) => {
            const actions = input.actions.map((action) => ({ actionType: action.type, label: action.type }));
            notifyAiChange(
                `${input.successVerb ?? 'Executed'}: ${input.prompt}`,
                actions.map((action) => action.actionType)
            );
            return Promise.resolve({ status: 'committed', actions });
        });
        vi.mocked(isComplexPrompt).mockReturnValue(false);
        vi.mocked(getAvailablePresets).mockReturnValue([]);
        vi.mocked(searchPresets).mockReturnValue([]);
        vi.mocked(resolvePresetActions).mockReturnValue([]);
        vi.mocked(requiresAppActionConfirmation).mockReturnValue(false);
    });

    it('starts with an empty, idle default state', () => {
        const { result } = renderHook(() => usePromptExecution());

        expect(result.current.value).toBe('');
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.preview).toBeNull();
        expect(result.current.selectionTags).toEqual([]);
        expect(result.current.willUseLlm).toBe(false);
    });

    it('derives selection tags for the current track/clip selection, drops dismissed ones, and restores them when the selection changes', () => {
        const track = { id: 't1', name: 'Drums', clips: [{ id: 'c1', name: 'Clip A', type: 'audio' }] };
        trackState = { tracks: [track], selectedTrackId: 't1' };
        const { result, rerender } = renderHook(() => usePromptExecution());
        expect(result.current.selectionTags).toEqual([
            { id: 'track:t1', label: 'Drums', kind: 'track', icon: 'track' },
        ]);

        act(() => result.current.dismissTag('track:t1'));
        rerender();
        expect(result.current.selectionTags).toEqual([]);

        const bass = { id: 't2', name: 'Bass', clips: [] };
        trackState = { tracks: [track, bass], selectedTrackId: 't2' };
        rerender();
        expect(result.current.selectionTags).toEqual([{ id: 'track:t2', label: 'Bass', kind: 'track', icon: 'track' }]);

        clipState = { selectedClipId: null, selectedClipIds: ['c1', 'c2'], marqueeSelection: null };
        rerender();
        expect(result.current.selectionTags).toContainEqual({
            id: 'clips:2',
            label: '2 clips',
            kind: 'clips',
            icon: 'clips',
        });

        trackState = { tracks: [track, bass], selectedTrackId: null };
        clipState = { selectedClipId: 'c1', selectedClipIds: [], marqueeSelection: null };
        rerender();
        expect(result.current.selectionTags).toContainEqual({
            id: 'clip:c1',
            label: 'Clip A',
            kind: 'clip',
            icon: 'clip',
        });
    });

    it('runs fuzzy search while focused and idle, and suppresses it when blurred', () => {
        vi.mocked(getAvailablePresets).mockReturnValue(
            Array.from({ length: 12 }, (_v, i) => preset({ id: `p${i}`, label: `P${i}` }))
        );
        vi.mocked(searchPresets).mockReturnValue([fuzzy(preset({ id: 'match', label: 'Match' }))]);
        const { result } = renderHook(() => usePromptExecution());

        act(() => result.current.setIsFocused(true));
        expect(result.current.fuzzyResults).toHaveLength(10);

        act(() => result.current.setValue('play'));
        expect(vi.mocked(searchPresets)).toHaveBeenCalledWith('play', expect.any(Object), 10);
        expect(result.current.fuzzyResults).toEqual([fuzzy(preset({ id: 'match', label: 'Match' }))]);

        act(() => result.current.setIsFocused(false));
        expect(result.current.fuzzyResults).toEqual([]);
    });

    it('previews a destructive preset, skips presets with no actions, and executes a non-destructive one through the action group', async () => {
        const deleteAction: AppAction = { type: 'removeAllTracks' };
        vi.mocked(resolvePresetActions).mockReturnValue([deleteAction]);
        const { result } = renderHook(() => usePromptExecution());
        const destructive = fuzzy(preset({ id: 'delete-track', label: 'Delete track', isDestructive: true }));

        act(() => {
            void result.current.executePreset(destructive);
        });
        expect(result.current.preview).toEqual({
            actions: [deleteAction],
            actionLabels: ['removeAllTracks'],
            rawText: 'Delete track',
            requiresConfirmation: true,
            projectRevision: 'revision-1',
        });
        expect(vi.mocked(executePlannedActions)).not.toHaveBeenCalled();

        act(() => result.current.cancelPreview());

        vi.mocked(resolvePresetActions).mockReturnValue([]);
        act(() => {
            void result.current.executePreset(fuzzy(preset({ id: 'no-op' })));
        });
        expect(vi.mocked(executePlannedActions)).not.toHaveBeenCalled();

        const playAction: AppAction = { type: 'togglePlayback' };
        vi.mocked(resolvePresetActions).mockReturnValue([playAction]);
        await act(async () => {
            await result.current.executePreset(fuzzy(preset()));
        });
        expect(vi.mocked(executePlannedActions)).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [playAction],
                prompt: 'Play',
                projectRevision: 'revision-1',
                signal: expect.any(AbortSignal),
            })
        );
        expect(vi.mocked(executePlannedActions).mock.calls.at(-1)?.[0].commandBatch?.serialized).toBe('command-batch');
        expect(vi.mocked(compilePlannedActionCommandBatch)).toHaveBeenCalledWith(
            expect.objectContaining({ actions: [playAction], autoCommit: true, projectRevision: 'revision-1' })
        );
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Executed: Play', ['togglePlayback']);
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.value).toBe('');
    });

    it('uses app-owned action policy even when preset metadata says an action is safe', async () => {
        const routingAction: AppAction = {
            type: 'setTrackOutput',
            payload: { trackId: 'track-1', outputId: 'master' },
        };
        vi.mocked(resolvePresetActions).mockReturnValue([routingAction]);
        vi.mocked(requiresAppActionConfirmation).mockReturnValue(true);
        const { result } = renderHook(() => usePromptExecution());

        await act(async () => {
            await result.current.executePreset(
                fuzzy(preset({ id: 'route-track', label: 'Route track', isDestructive: false }))
            );
        });

        expect(vi.mocked(requiresAppActionConfirmation)).toHaveBeenCalledWith([routingAction]);
        expect(result.current.preview).toEqual(
            expect.objectContaining({ actions: [routingAction], requiresConfirmation: true })
        );
        expect(vi.mocked(executePlannedActions)).not.toHaveBeenCalled();
    });

    it('keeps a direct preset locked until Stop cancellation settles', async () => {
        vi.mocked(resolvePresetActions).mockReturnValue([{ type: 'togglePlayback' }]);
        vi.mocked(executePlannedActions).mockImplementationOnce((input) => {
            return new Promise((resolve) => {
                input.signal?.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
            });
        });
        const { result } = renderHook(() => usePromptExecution());

        let execution = Promise.resolve();
        act(() => {
            execution = result.current.executePreset(fuzzy(preset()));

            void result.current.executePreset(fuzzy(preset()));
        });

        expect(vi.mocked(executePlannedActions)).toHaveBeenCalledTimes(1);
        const executionSignal = vi.mocked(executePlannedActions).mock.calls[0]?.[0].signal;
        expect(result.current.isProcessing).toBe(true);
        expect(executionSignal?.aborted).toBe(false);

        act(() => result.current.cancelProcessing());
        expect(executionSignal?.aborted).toBe(true);
        expect(result.current.isProcessing).toBe(true);

        await act(async () => execution);
        expect(result.current.isProcessing).toBe(false);
    });

    it('does not retry a failed post-commit notification or report the committed command as failed', async () => {
        vi.mocked(resolvePresetActions).mockReturnValue([{ type: 'togglePlayback' }]);
        vi.mocked(executePlannedActions).mockResolvedValueOnce({
            status: 'committed',
            actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
            reportingWarning: 'notification: toast unavailable',
        });
        const { result } = renderHook(() => usePromptExecution());

        await act(async () => {
            await result.current.executePreset(fuzzy(preset()));
        });

        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
        expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
        expect(result.current.isProcessing).toBe(false);
    });

    it.each([undefined, 'transport follow-up unavailable'])(
        'treats a runtime preset as successful without reporting a false no-op (warning: %s)',
        async (executionWarning) => {
            const action: AppAction = { type: 'setPlayback', payload: { playing: true } };
            vi.mocked(resolvePresetActions).mockReturnValue([action]);
            vi.mocked(executePlannedActions).mockResolvedValueOnce({
                status: 'executed',
                actions: [{ actionType: action.type, label: 'Start playback' }],
                ...(executionWarning ? { executionWarning } : {}),
            });
            const { result } = renderHook(() => usePromptExecution());

            await act(async () => {
                await result.current.executePreset(fuzzy(preset()));
            });

            expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
            expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
            expect(result.current.isProcessing).toBe(false);
        }
    );

    it('submits a prompt and executes it directly, or previews it first when confirmation is required', async () => {
        const stopAction: AppAction = { type: 'stopPlayback' };
        vi.mocked(parsePromptToActions).mockResolvedValue({
            actions: [stopAction],
            rawText: 'stop playback',
            requiresConfirmation: false,
        });
        const { result } = renderHook(() => usePromptExecution());
        act(() => result.current.setValue('stop playback'));

        await act(async () => {
            await result.current.handleSubmit(formEvent as never);
        });
        expect(vi.mocked(executePlannedActions)).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [stopAction],
                prompt: 'stop playback',
                projectRevision: 'revision-1',
            })
        );
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Executed: stop playback', ['stopPlayback']);
        expect(result.current.value).toBe('');

        const deleteAction: AppAction = { type: 'removeTrack', payload: { trackId: 'track-drums' } };
        vi.mocked(getProjectContext).mockReturnValue({
            tempo: 120,
            timeSignature: [4, 4],
            isPlaying: false,
            isRecording: false,
            isLooping: false,
            loopStart: 0,
            loopEnd: 0,
            punchInEnabled: false,
            punchInBeat: 0,
            punchOutBeat: 16,
            metronomeEnabled: false,
            metronomeVolume: 0.5,
            masterGain: 0.8,
            tracks: [
                {
                    id: 'track-drums',
                    name: 'Drums',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
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
            selectedTrackId: 'track-drums',
            selectedClipId: null,
            selectedClipIds: [],
            activeView: 'arrange',
            playheadPosition: 0,
        });
        vi.mocked(parsePromptToActions).mockResolvedValue({
            actions: [deleteAction],
            rawText: 'delete Drums',
            requiresConfirmation: true,
        });
        act(() => result.current.setValue('delete Drums'));
        await act(async () => {
            await result.current.handleSubmit(formEvent as never);
        });
        expect(result.current.preview).toEqual({
            actions: [deleteAction],
            rawText: 'delete Drums',
            requiresConfirmation: true,
            actionLabels: ['Remove track "Drums"'],
            projectRevision: 'revision-1',
        });
        expect(result.current.value).toBe('delete Drums');
        expect(vi.mocked(executePlannedActions)).toHaveBeenCalledTimes(1);
    });

    it('notifies when no executable action matches', async () => {
        const { result } = renderHook(() => usePromptExecution());

        act(() => result.current.setValue('do something unknown'));
        await act(async () => {
            await result.current.handleSubmit(formEvent as never);
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenLastCalledWith(
            'No actions matched. Try rephrasing, or use the AI Chat panel for open-ended help.',
            []
        );
    });

    it('surfaces a rejected prompt receipt without executing or showing a no-match notice', async () => {
        vi.mocked(parsePromptToActions).mockResolvedValue({
            actions: [],
            rawText: 'save project',
            requiresConfirmation: false,
            rejectionReason: 'Action saveProject cannot be executed by AI because it does not report completion.',
        });
        const { result } = renderHook(() => usePromptExecution());

        act(() => result.current.setValue('save project'));
        await act(async () => {
            await result.current.handleSubmit(formEvent as never);
        });

        expect(vi.mocked(executePlannedActions)).not.toHaveBeenCalled();
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(
            'Command not executed: Action saveProject cannot be executed by AI because it does not report completion.',
            []
        );
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalledWith(
            'No actions matched. Try rephrasing, or use the AI Chat panel for open-ended help.',
            []
        );
    });

    it('ignores blank submissions and recovers after a parsing failure', async () => {
        const { result } = renderHook(() => usePromptExecution());

        await act(async () => {
            await result.current.handleSubmit(formEvent as never);
        });
        expect(vi.mocked(parsePromptToActions)).not.toHaveBeenCalled();

        vi.mocked(parsePromptToActions).mockRejectedValueOnce(new Error('parse failed'));
        act(() => result.current.setValue('break things'));
        await act(async () => {
            await result.current.handleSubmit(formEvent as never);
        });

        expect(vi.mocked(logger.error)).toHaveBeenCalled();
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.value).toBe('');
    });

    it('surfaces proposal invalidation from planning without logging an execution failure', async () => {
        const invalidated = new Error(
            'The project changed after this proposal was created. Review and submit the command again.'
        );
        invalidated.name = 'AiProposalInvalidatedError';
        vi.mocked(planPromptActions).mockRejectedValueOnce(invalidated);
        const { result } = renderHook(() => usePromptExecution());

        act(() => result.current.setValue('rename drums'));
        await act(async () => {
            await result.current.handleSubmit(formEvent as never);
        });

        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(`Command not executed: ${invalidated.message}`, []);
        expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
        expect(result.current.isProcessing).toBe(false);
    });

    it('confirms an immutable preview once, exposes Stop while committing, and still cancels an idle preview', async () => {
        const action: AppAction = { type: 'removeAllTracks' };
        vi.mocked(executePlannedActions).mockImplementationOnce((input) => {
            return new Promise((resolve) => {
                input.signal?.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
            });
        });
        const { result } = renderHook(() => usePromptExecution());

        await act(async () => {
            await result.current.confirmPreview();
        });
        expect(vi.mocked(executePlannedActions)).not.toHaveBeenCalled();

        vi.mocked(resolvePresetActions).mockReturnValue([action]);
        act(() => {
            void result.current.executePreset(
                fuzzy(preset({ id: 'delete-track', label: 'Delete track', isDestructive: true }))
            );
        });
        act(() => result.current.setValue('tampered text'));

        let confirmation = Promise.resolve();
        act(() => {
            confirmation = result.current.confirmPreview();
            void result.current.confirmPreview();
        });

        expect(vi.mocked(executePlannedActions)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(executePlannedActions)).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [action],
                prompt: 'Delete track',
                successVerb: 'Confirmed',
                projectRevision: 'revision-1',
            })
        );
        expect(result.current.preview).toBeNull();
        expect(result.current.isProcessing).toBe(true);

        const executionSignal = vi.mocked(executePlannedActions).mock.calls[0]?.[0].signal;
        expect(executionSignal?.aborted).toBe(false);
        act(() => result.current.cancelProcessing());
        expect(executionSignal?.aborted).toBe(true);

        expect(result.current.isProcessing).toBe(true);
        await act(async () => confirmation);
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(
            'Command cancelled before it committed. No project changes were applied.',
            []
        );
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.value).toBe('');

        act(() => {
            void result.current.executePreset(
                fuzzy(preset({ id: 'delete-track', label: 'Delete track', isDestructive: true }))
            );
        });
        act(() => result.current.cancelPreview());
        expect(result.current.preview).toBeNull();
    });

    it('notifies the user when a confirmed destructive preview reports a failed execution', async () => {
        vi.mocked(resolvePresetActions).mockReturnValue([{ type: 'removeAllTracks' }]);
        const { result } = renderHook(() => usePromptExecution());

        act(() => {
            void result.current.executePreset(
                fuzzy(preset({ id: 'delete-track', label: 'Delete track', isDestructive: true }))
            );
        });
        expect(result.current.preview).not.toBeNull();

        vi.mocked(executePlannedActions).mockResolvedValueOnce({ status: 'failed', reason: 'transaction rejected' });
        await act(async () => {
            await result.current.confirmPreview();
        });

        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Command not executed: transaction rejected', []);
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.value).toBe('');
    });

    it('logs and notifies instead of leaving an unhandled rejection when confirming a preview throws', async () => {
        vi.mocked(resolvePresetActions).mockReturnValue([{ type: 'removeAllTracks' }]);
        const { result } = renderHook(() => usePromptExecution());

        act(() => {
            void result.current.executePreset(
                fuzzy(preset({ id: 'delete-track', label: 'Delete track', isDestructive: true }))
            );
        });
        expect(result.current.preview).not.toBeNull();

        vi.mocked(executePlannedActions).mockRejectedValueOnce(new Error('snapshot transaction never settled'));
        await act(async () => {
            // Awaited directly: without the catch inside confirmPreview this rejects,
            // which is the unhandled rejection the app would ship.
            await result.current.confirmPreview();
        });

        expect(vi.mocked(logger.error)).toHaveBeenCalled();
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(
            'Command not executed: the confirmed changes could not be applied.',
            []
        );
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.value).toBe('');
    });

    it('flags willUseLlm only for non-empty, complex prompts', () => {
        vi.mocked(isComplexPrompt).mockImplementation((text: string) => text === 'complex query');
        const { result } = renderHook(() => usePromptExecution());

        act(() => result.current.setValue('complex query'));
        expect(result.current.willUseLlm).toBe(true);

        act(() => result.current.setValue(''));
        expect(result.current.willUseLlm).toBe(false);
    });

    it('subscribes to voice injection and rejects injected text while a confirmation is pending', () => {
        const unsubscribe = vi.fn();
        let injector: ((text: string) => void) | null = null;
        vi.mocked(onPromptInjection).mockImplementation((handler) => {
            injector = handler;
            return unsubscribe;
        });

        const { result, unmount } = renderHook(() => usePromptExecution());
        expect(injector).not.toBeNull();

        act(() => {
            injector!('play');
        });
        expect(result.current.value).toBe('play');

        act(() => {
            injector!('stop');
        });
        expect(result.current.value).toBe('play stop');

        vi.mocked(resolvePresetActions).mockReturnValue([{ type: 'removeAllTracks' }]);
        act(() => {
            void result.current.executePreset(
                fuzzy(preset({ id: 'delete-track', label: 'Delete track', isDestructive: true }))
            );
        });
        expect(result.current.preview).not.toBeNull();
        expect(result.current.value).toBe('Delete track');

        act(() => {
            injector!('rename drums');
        });
        expect(result.current.value).toBe('Delete track');
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(
            'Voice command not accepted while another AI command is pending or running.',
            []
        );

        unmount();
        expect(unsubscribe).toHaveBeenCalled();
    });

    it('navigates the fuzzy list with ArrowDown/ArrowUp, accepts with Tab, submits with Enter, and dismisses with Escape', () => {
        vi.mocked(getAvailablePresets).mockReturnValue([
            preset({ id: 'a', label: 'A' }),
            preset({ id: 'b', label: 'B' }),
            preset({ id: 'c', label: 'C' }),
        ]);
        const { result } = renderHook(() => usePromptExecution());
        act(() => result.current.setIsFocused(true));
        // fuzzyResults seeded with available presets
        expect(result.current.fuzzyResults).toHaveLength(3);
        expect(result.current.selectedIndex).toBe(-1);

        const mk = (key: string): { key: string; preventDefault: () => void } => ({ key, preventDefault: vi.fn() });

        const down = mk('ArrowDown');
        act(() => result.current.handleKeyDown(down as never));
        expect(down.preventDefault).toHaveBeenCalled();
        expect(result.current.selectedIndex).toBe(0);

        act(() => result.current.handleKeyDown(mk('ArrowDown') as never));
        expect(result.current.selectedIndex).toBe(1);

        // Clamp at the bottom
        act(() => result.current.handleKeyDown(mk('ArrowDown') as never));
        act(() => result.current.handleKeyDown(mk('ArrowDown') as never));
        expect(result.current.selectedIndex).toBe(2);

        // ArrowUp moves back and clamps at -1
        const up = mk('ArrowUp');
        act(() => result.current.handleKeyDown(up as never));
        expect(up.preventDefault).toHaveBeenCalled();
        expect(result.current.selectedIndex).toBe(1);
        act(() => result.current.handleKeyDown(mk('ArrowUp') as never));
        act(() => result.current.handleKeyDown(mk('ArrowUp') as never));
        act(() => result.current.handleKeyDown(mk('ArrowUp') as never));
        expect(result.current.selectedIndex).toBe(-1);

        // Select index 1, Tab fills the input with the preset label
        act(() => result.current.handleKeyDown(mk('ArrowDown') as never));
        act(() => result.current.handleKeyDown(mk('ArrowDown') as never));
        const tabEvent = mk('Tab');
        act(() => result.current.handleKeyDown(tabEvent as never));
        expect(tabEvent.preventDefault).toHaveBeenCalled();
        expect(result.current.value).toBe('B');
        expect(result.current.fuzzyResults).toHaveLength(0);

        // Keyboard matrix is inert once the fuzzy list is cleared
        const inert = mk('ArrowDown');
        act(() => result.current.handleKeyDown(inert as never));
        expect(inert.preventDefault).not.toHaveBeenCalled();
    });

    it('executes the selected preset on Enter', async () => {
        const playAction: AppAction = { type: 'togglePlayback' };
        vi.mocked(getAvailablePresets).mockReturnValue([preset({ id: 'play', label: 'Play' })]);
        vi.mocked(resolvePresetActions).mockReturnValue([playAction]);
        const { result } = renderHook(() => usePromptExecution());
        act(() => result.current.setIsFocused(true));
        act(() => result.current.handleKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() } as never));

        await act(async () => {
            result.current.handleKeyDown({ key: 'Enter', preventDefault: vi.fn() } as never);
        });
        expect(vi.mocked(executePlannedActions)).toHaveBeenCalledWith(
            expect.objectContaining({
                actions: [playAction],
                prompt: 'Play',
                projectRevision: 'revision-1',
                signal: expect.any(AbortSignal),
            })
        );
    });

    it('dismisses the fuzzy list on Escape without executing', () => {
        vi.mocked(getAvailablePresets).mockReturnValue([preset({ id: 'a', label: 'A' })]);
        const { result } = renderHook(() => usePromptExecution());
        act(() => result.current.setIsFocused(true));
        act(() => result.current.handleKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() } as never));
        expect(result.current.fuzzyResults).toHaveLength(1);

        act(() => result.current.handleKeyDown({ key: 'Escape', preventDefault: vi.fn() } as never));
        expect(result.current.fuzzyResults).toHaveLength(0);
        expect(result.current.selectedIndex).toBe(-1);
    });

    it('ignores ArrowUp/Tab/Enter/Escape when no fuzzy results are shown', () => {
        const { result } = renderHook(() => usePromptExecution());
        const evt = { key: 'ArrowDown', preventDefault: vi.fn() };
        act(() => result.current.handleKeyDown(evt as never));
        expect(evt.preventDefault).not.toHaveBeenCalled();
    });

    it('ignores Tab/Enter when the index is -1 (nothing selected)', () => {
        vi.mocked(getAvailablePresets).mockReturnValue([preset({ id: 'a', label: 'A' })]);
        const { result } = renderHook(() => usePromptExecution());
        act(() => result.current.setIsFocused(true));
        const tab = { key: 'Tab', preventDefault: vi.fn() };
        act(() => result.current.handleKeyDown(tab as never));
        // value unchanged because no selection
        expect(result.current.value).toBe('');
        expect(tab.preventDefault).not.toHaveBeenCalled();
    });

    it('aborts an in-flight submit when the abort signal fires after parsing resolves', async () => {
        const stopAction: AppAction = { type: 'stopPlayback' };
        // Resolve after a microtask so the abort can race it
        let resolveParse: (value: { actions: AppAction[]; rawText: string; requiresConfirmation: boolean }) => void;
        vi.mocked(parsePromptToActions).mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveParse = resolve;
                })
        );
        const { result } = renderHook(() => usePromptExecution());
        act(() => result.current.setValue('stop'));

        let pending: Promise<void> = Promise.resolve();
        act(() => {
            pending = Promise.resolve(result.current.handleSubmit(formEvent as never));
        });
        // Abort mid-flight, then let the parse resolve
        act(() => result.current.cancelProcessing());
        await act(async () => {
            resolveParse!({ actions: [stopAction], rawText: 'stop', requiresConfirmation: false });
            await pending;
        });
        // Aborted before the action branch ran
        expect(vi.mocked(executePlannedActions)).not.toHaveBeenCalled();
    });

    it('loads a model through initEngine only when the LLM is available', () => {
        vi.mocked(isLlmAvailable).mockReturnValue(false);
        const { result } = renderHook(() => usePromptExecution());
        act(() => result.current.handleLoadModel('gpt-4'));
        expect(vi.mocked(initEngine)).not.toHaveBeenCalled();

        vi.mocked(isLlmAvailable).mockReturnValue(true);
        act(() => result.current.handleLoadModel('gpt-4'));
        expect(vi.mocked(initEngine)).toHaveBeenCalledWith('gpt-4');
    });

    it('swallows errors thrown by executePreset and clears processing', async () => {
        vi.mocked(resolvePresetActions).mockReturnValue([{ type: 'togglePlayback' }]);
        vi.mocked(executePlannedActions).mockRejectedValueOnce(new Error('boom'));
        const { result } = renderHook(() => usePromptExecution());

        await act(async () => {
            await result.current.executePreset(fuzzy(preset()));
        });
        expect(vi.mocked(logger.error)).toHaveBeenCalled();
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.value).toBe('');
    });
});

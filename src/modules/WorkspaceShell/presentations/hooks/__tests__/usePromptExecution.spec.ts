import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { llmStatusStore } from '#/modules/AiRuntime/stores';
import {
    parsePromptToActions,
    isComplexPrompt,
    searchPresets,
    getAvailablePresets,
    resolvePresetActions,
    notifyAiChange,
    recordAiActionGroup,
} from '#/modules/AiRuntime/useCases';
import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { usePromptExecution } from '../usePromptExecution';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('#/infra/store/useStore', () => ({ useStore: vi.fn() }));
vi.mock('#/modules/AiRuntime/stores', () => ({ llmStatusStore: { value: { state: 'idle' } } }));
vi.mock('#/modules/AiRuntime/useCases', () => ({
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
    recordAiActionGroup: vi.fn(),
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: null },
    clipSelectionStore: { value: null },
    defaultTrackState: { tracks: [], selectedTrackId: null },
    defaultClipSelectionState: { selectedClipId: null, selectedClipIds: [], marqueeSelection: null },
}));
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn().mockResolvedValue(undefined),
    generateGroupId: vi.fn((label: string) => ({ groupId: 'group-1', groupLabel: label })),
    describeAction: vi.fn((action: { type: string }) => action.type),
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
        vi.mocked(isComplexPrompt).mockReturnValue(false);
        vi.mocked(getAvailablePresets).mockReturnValue([]);
        vi.mocked(searchPresets).mockReturnValue([]);
        vi.mocked(resolvePresetActions).mockReturnValue([]);
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
        });
        expect(vi.mocked(executeAppAction)).not.toHaveBeenCalled();

        vi.mocked(resolvePresetActions).mockReturnValue([]);
        act(() => {
            void result.current.executePreset(fuzzy(preset({ id: 'no-op' })));
        });
        expect(vi.mocked(executeAppAction)).not.toHaveBeenCalled();

        const playAction: AppAction = { type: 'togglePlayback' };
        vi.mocked(resolvePresetActions).mockReturnValue([playAction]);
        await act(async () => {
            await result.current.executePreset(fuzzy(preset()));
        });
        expect(vi.mocked(executeAppAction)).toHaveBeenCalledWith(
            playAction,
            expect.objectContaining({ source: 'prompt' })
        );
        expect(vi.mocked(recordAiActionGroup)).toHaveBeenCalledWith(
            expect.objectContaining({ prompt: 'Play', groupId: 'group-1' })
        );
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Executed: Play', ['togglePlayback']);
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.value).toBe('');
    });

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
        expect(vi.mocked(executeAppAction)).toHaveBeenCalledWith(
            stopAction,
            expect.objectContaining({ source: 'prompt' })
        );
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Executed: stop playback', ['stopPlayback']);
        expect(result.current.value).toBe('');

        const deleteAction: AppAction = { type: 'removeAllTracks' };
        vi.mocked(parsePromptToActions).mockResolvedValue({
            actions: [deleteAction],
            rawText: 'delete all',
            requiresConfirmation: true,
        });
        act(() => result.current.setValue('delete all'));
        await act(async () => {
            await result.current.handleSubmit(formEvent as never);
        });
        expect(result.current.preview).toEqual({
            actions: [deleteAction],
            rawText: 'delete all',
            requiresConfirmation: true,
            actionLabels: ['removeAllTracks'],
        });
        expect(result.current.value).toBe('delete all');
        expect(vi.mocked(executeAppAction)).toHaveBeenCalledTimes(1);
    });

    it('notifies on an already-applied JSON edit and falls back to a no-match notice otherwise', async () => {
        const { result } = renderHook(() => usePromptExecution());

        vi.mocked(parsePromptToActions).mockResolvedValueOnce({
            actions: [],
            rawText: 'x',
            requiresConfirmation: false,
            _jsonEditApplied: true,
            _jsonEditSummaries: ['Renamed track'],
        });
        act(() => result.current.setValue('rename track to Bass'));
        await act(async () => {
            await result.current.handleSubmit(formEvent as never);
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Renamed track', []);

        act(() => result.current.setValue('do something unknown'));
        await act(async () => {
            await result.current.handleSubmit(formEvent as never);
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenLastCalledWith(
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

    it('confirms and cancels a preview, and safely cancels processing with nothing in flight', async () => {
        const action: AppAction = { type: 'removeAllTracks' };
        const { result } = renderHook(() => usePromptExecution());

        await act(async () => {
            await result.current.confirmPreview();
        });
        expect(vi.mocked(executeAppAction)).not.toHaveBeenCalled();

        vi.mocked(resolvePresetActions).mockReturnValue([action]);
        act(() => {
            void result.current.executePreset(
                fuzzy(preset({ id: 'delete-track', label: 'Delete track', isDestructive: true }))
            );
        });
        expect(result.current.preview).not.toBeNull();

        await act(async () => {
            await result.current.confirmPreview();
        });
        expect(vi.mocked(executeAppAction)).toHaveBeenCalledWith(action, expect.objectContaining({ source: 'prompt' }));
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Confirmed: Delete track', ['removeAllTracks']);
        expect(result.current.preview).toBeNull();

        act(() => {
            void result.current.executePreset(
                fuzzy(preset({ id: 'delete-track', label: 'Delete track', isDestructive: true }))
            );
        });
        act(() => result.current.cancelPreview());
        expect(result.current.preview).toBeNull();

        expect(() => result.current.cancelProcessing()).not.toThrow();
    });

    it('flags willUseLlm only for non-empty, complex prompts', () => {
        vi.mocked(isComplexPrompt).mockImplementation((text: string) => text === 'complex query');
        const { result } = renderHook(() => usePromptExecution());

        act(() => result.current.setValue('complex query'));
        expect(result.current.willUseLlm).toBe(true);

        act(() => result.current.setValue(''));
        expect(result.current.willUseLlm).toBe(false);
    });
});

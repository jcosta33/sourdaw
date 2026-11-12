import { useRef, useState } from 'react';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getFinalFeatureHandlers } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import * as commandUseCases from '#/modules/Command/useCases';
import { useGlobalKeyboardShortcuts } from '#/modules/CommandInterface/presentations/views';
import { ElasticEditorPanel } from '#/modules/ElasticAudio/presentations/views';
import { elasticAudioStore } from '#/modules/ElasticAudio/stores';
import { defaultProjectStoreState, projectLoadFailureStore, projectStore } from '#/modules/Project/stores';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';
import { type ActionHandler } from '#/utils/handlerContract';

import { createTrack, type Clip, type Track } from '../../../models/Track';
import { clipSelectionStore, defaultClipSelectionState } from '../../../stores/clipSelectionStore';
import { timelineViewStore } from '../../../stores/timelineViewStore';
import { defaultTrackState, trackStore } from '../../../stores/trackStore';
import { getWarpState } from '../../../stores/warpStates';
import { moveClip } from '../../../useCases/clip/moveClip';
import { selectClipWithFocus } from '../../../useCases/clipSelection/selectClipWithFocus';
import { selectTrack } from '../../../useCases/toggleTrackState/selectTrack';
import { TimelineClipNavigator } from '../TimelineClipNavigator';

function ShortcutHost() {
    useGlobalKeyboardShortcuts();
    return null;
}

const togglePlaybackHandler: ActionHandler = {
    executionKind: 'runtime',
    undoable: false,
    execute: () => {},
    describe: () => ({ label: 'togglePlayback' }),
};

function clip(id: string, trackId: string, startBeat: number, name = id): Clip {
    return {
        id,
        trackId,
        name,
        startBeat,
        endBeat: startBeat + 2,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function track(id: string, name: string, clips: Clip[], extra: Partial<Track> = {}): Track {
    return {
        ...createTrack({
            id,
            name,
            kind: 'midi',
            initialDeviceId: `${id}-device`,
            initialAlternativeId: `${id}-alternative`,
        }),
        clips,
        ...extra,
    };
}

function NavigatorHost() {
    const trigger = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return (
        <>
            <button ref={trigger} onClick={() => setOpen(true)}>
                Browse timeline clips
            </button>
            {open ? (
                <TimelineClipNavigator
                    onClose={() => {
                        setOpen(false);
                        trigger.current?.focus();
                    }}
                />
            ) : null}
        </>
    );
}

function openNavigator() {
    render(<NavigatorHost />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse timeline clips' }));
    return screen.getByRole('listbox', { name: 'Timeline clips' });
}

function activeOption(listbox: HTMLElement): HTMLElement {
    const id = listbox.getAttribute('aria-activedescendant');
    expect(id).toBeTruthy();
    const option = document.getElementById(id!);
    expect(option).toBeInTheDocument();
    return option!;
}

describe('TimelineClipNavigator', () => {
    beforeEach(() => {
        projectLoadFailureStore.set(null);
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false, initialized: true });
        clearHandlerRegistry();
        injectDependencies(selectTrack, { eventBus: { emit: async () => {} } });
        commandUseCases.setCommandEventBus({ emit: async () => {} });
        act(() => {
            clipSelectionStore.set(defaultClipSelectionState);
            trackStore.set({ ...defaultTrackState, tracks: [] });
            timelineViewStore.set({
                scrollX: 0,
                scrollY: 0,
                pixelsPerBeat: 12,
                autoScrollEnabled: true,
                viewportHeight: 0,
                viewportWidth: 0,
            });
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        clearHandlerRegistry();
        Container.clear();
        act(() => {
            clipSelectionStore.set(defaultClipSelectionState);
            trackStore.set({ ...defaultTrackState, tracks: [] });
            timelineViewStore.set(null);
        });
    });

    it('browses without selecting, then toggles and commits through the real selection owners', () => {
        act(() => {
            trackStore.set({
                ...defaultTrackState,
                tracks: [
                    track('voice', 'Voice', [clip('verse', 'voice', 0, 'Verse')]),
                    track('drums', 'Drums', [clip('fill', 'drums', 8, 'Fill')]),
                ],
            });
        });
        const listbox = openNavigator();
        const search = screen.getByRole('searchbox', { name: 'Search clips' });
        expect(search).toHaveFocus();
        expect(activeOption(listbox)).toHaveAccessibleName(/Verse, Voice, MIDI clip, start beat 0, end beat 2/);
        expect(within(listbox).getAllByRole('option')).toHaveLength(2);

        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(listbox).toHaveFocus();
        expect(activeOption(listbox)).toHaveAccessibleName(/Fill, Drums, MIDI clip, start beat 8, end beat 10/);
        expect(clipSelectionStore.value?.selectedClipIds).toEqual([]);
        expect(within(listbox).getByRole('option', { name: /Fill/ })).toHaveAttribute('aria-selected', 'false');

        fireEvent.keyDown(listbox, { key: ' ' });
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['fill']);
        expect(within(listbox).getByRole('option', { name: /Fill/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('status')).toHaveTextContent(/Selected Fill, Drums.*start beat 8, end beat 10/);

        fireEvent.keyDown(listbox, { key: 'Home' });
        fireEvent.keyDown(listbox, { key: 'Enter' });
        expect(trackStore.value?.selectedTrackId).toBe('voice');
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['verse']);
        expect(within(listbox).getByRole('option', { name: /Verse/ })).toHaveAttribute('aria-selected', 'true');
        expect(listbox).toHaveFocus();

        fireEvent.keyDown(listbox, { key: 'Escape' });
        expect(screen.queryByRole('listbox', { name: 'Timeline clips' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Browse timeline clips' })).toHaveFocus();
    });

    it('announces pointer selection, preserves the renderer union, and bounds multi-selection speech', () => {
        act(() => {
            trackStore.set({
                ...defaultTrackState,
                tracks: [track('voice', 'Voice', [clip('one', 'voice', 0), clip('two', 'voice', 4)])],
            });
        });
        const listbox = openNavigator();
        act(() => selectClipWithFocus('two'));
        expect(screen.getByRole('status')).toHaveTextContent(/Selected two, Voice.*start beat 4, end beat 6/);
        expect(within(listbox).getByRole('option', { name: /two/ })).toHaveAttribute('aria-selected', 'true');

        act(() => {
            clipSelectionStore.set({
                ...defaultClipSelectionState,
                selectedClipId: 'two',
                selectedClipIds: ['one'],
            });
        });
        expect(within(listbox).getByRole('option', { name: /one/ })).toHaveAttribute('aria-selected', 'true');
        expect(within(listbox).getByRole('option', { name: /two/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('status')).toHaveTextContent('2 clips selected; focused two');
    });

    it('opens with the existing selection active without changing that selection', () => {
        act(() => {
            trackStore.set({
                ...defaultTrackState,
                tracks: [track('voice', 'Voice', [clip('one', 'voice', 0), clip('two', 'voice', 4)])],
            });
            selectClipWithFocus('two');
        });
        const listbox = openNavigator();
        expect(activeOption(listbox)).toHaveAccessibleName(/two, Voice/);
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['two']);
    });

    it('keeps the active clip through a live cross-track move and Enter selects that identity', () => {
        act(() => {
            trackStore.set({
                ...defaultTrackState,
                tracks: [
                    track('first', 'First', [clip('anchor', 'first', 0, 'Anchor')]),
                    track('second', 'Second', [clip('moved', 'second', 8, 'Moved')]),
                ],
            });
            selectClipWithFocus('moved');
        });
        const listbox = openNavigator();

        expect(activeOption(listbox)).toHaveAccessibleName(/Moved, Second/);
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['moved']);

        act(() => {
            expect(moveClip('moved', 'first', 8, undefined, false)).toBe(true);
        });

        expect(screen.getByRole('status')).toHaveTextContent(/Selected Moved, First/);
        expect(activeOption(listbox)).toHaveAccessibleName(/Moved, First/);
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['moved']);

        fireEvent.keyDown(listbox, { key: 'Enter' });

        expect(trackStore.value?.selectedTrackId).toBe('first');
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['moved']);
        expect(within(listbox).getByRole('option', { name: /Moved, First/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('includes offscreen canonical clips, excludes collapsed children and master, and retargets removal', () => {
        const folder = track('folder', 'Folder', [], { kind: 'folder', collapsed: true });
        const child = track('child', 'Hidden child', [clip('hidden', 'child', 0)], { parentId: 'folder' });
        const master = track('master', 'Master', [clip('master-clip', 'master', 0)], { kind: 'master' });
        const voice = track('voice', 'Voice', [clip('near', 'voice', 0), clip('far', 'voice', 10000)]);
        act(() =>
            trackStore.set({
                ...defaultTrackState,
                tracks: [folder, child, master, voice],
                ghostClips: [clip('transient-ghost', 'voice', 1)],
            })
        );
        const listbox = openNavigator();
        expect(within(listbox).getAllByRole('option')).toHaveLength(2);
        expect(within(listbox).queryByRole('option', { name: /transient-ghost|Hidden child|master-clip/ })).toBeNull();
        fireEvent.keyDown(listbox, { key: 'End' });
        expect(activeOption(listbox)).toHaveAccessibleName(/far.*start beat 10000/);

        act(() =>
            trackStore.set({
                ...defaultTrackState,
                tracks: [folder, child, master, track('voice', 'Voice', [clip('near', 'voice', 0)])],
            })
        );
        expect(activeOption(listbox)).toHaveAccessibleName(/near/);
        expect(screen.getByRole('searchbox', { name: 'Search clips' })).toHaveFocus();

        act(() => trackStore.set({ ...defaultTrackState, tracks: [] }));
        expect(screen.getByText('No clips')).toBeInTheDocument();
        expect(listbox).not.toHaveAttribute('aria-activedescendant');
    });

    it('orders by visible track, then start beat and clip identity', () => {
        act(() =>
            trackStore.set({
                ...defaultTrackState,
                tracks: [
                    track('first', 'First', [clip('z', 'first', 4), clip('b', 'first', 0), clip('a', 'first', 4)]),
                    track('second', 'Second', [clip('early', 'second', 0)]),
                ],
            })
        );
        const listbox = openNavigator();
        expect(
            within(listbox)
                .getAllByRole('option')
                .map((option) => option.textContent)
        ).toEqual(['b · First', 'a · First', 'z · First', 'early · Second']);
    });

    it('keeps the mounted option count bounded while traversing more than a thousand clips', () => {
        const clips = Array.from({ length: 1001 }, (_, index) => clip(`clip-${index}`, 'long', index));
        act(() => trackStore.set({ ...defaultTrackState, tracks: [track('long', 'Long track', clips)] }));
        const listbox = openNavigator();
        expect(within(listbox).getAllByRole('option').length).toBeLessThanOrEqual(9);
        expect(activeOption(listbox)).toHaveAttribute('aria-posinset', '1');
        fireEvent.keyDown(listbox, { key: 'End' });
        expect(activeOption(listbox)).toHaveAttribute('aria-posinset', '1001');
        expect(activeOption(listbox)).toHaveAttribute('aria-setsize', '1001');
        fireEvent.keyDown(listbox, { key: 'Home' });
        for (let index = 0; index < 1000; index++) {
            fireEvent.keyDown(listbox, { key: 'ArrowDown' });
        }
        expect(activeOption(listbox)).toHaveAttribute('aria-posinset', '1001');
        expect(within(listbox).getAllByRole('option').length).toBeLessThanOrEqual(9);
        expect(clipSelectionStore.value?.selectedClipIds).toEqual([]);
    });

    it('contains listbox keys without canceling native Tab or changing shortcuts outside it', async () => {
        act(() =>
            trackStore.set({ ...defaultTrackState, tracks: [track('voice', 'Voice', [clip('one', 'voice', 0)])] })
        );
        registerHandlerMap({ togglePlayback: togglePlaybackHandler });
        const commandIntent = vi.spyOn(commandUseCases, 'executeUserAppAction').mockResolvedValue(undefined);
        const windowKeydown = vi.fn<(event: KeyboardEvent) => void>();
        window.addEventListener('keydown', windowKeydown);
        try {
            render(<ShortcutHost />);
            const listbox = openNavigator();

            fireEvent.keyDown(listbox, { key: ' ' });
            expect(windowKeydown).not.toHaveBeenCalled();
            expect(commandIntent).not.toHaveBeenCalled();
            expect(clipSelectionStore.value?.selectedClipIds).toEqual(['one']);
            expect(within(listbox).getByRole('option', { name: /one, Voice/ })).toHaveAttribute(
                'aria-selected',
                'true'
            );

            expect(fireEvent.keyDown(listbox, { key: 'Delete' })).toBe(true);
            expect(fireEvent.keyDown(listbox, { key: 'Tab' })).toBe(true);
            expect(windowKeydown).not.toHaveBeenCalled();
            expect(commandIntent).not.toHaveBeenCalled();
            expect(trackStore.value?.tracks[0]?.clips.map((item) => item.id)).toEqual(['one']);
            expect(clipSelectionStore.value?.selectedClipIds).toEqual(['one']);
            expect(within(listbox).getByRole('option', { name: /one, Voice/ })).toHaveAttribute(
                'aria-selected',
                'true'
            );

            windowKeydown.mockClear();
            fireEvent.keyDown(screen.getByRole('button', { name: 'Browse timeline clips' }), { key: ' ' });
            expect(windowKeydown).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: ' ' }));
            await waitFor(() => expect(commandIntent).toHaveBeenCalledExactlyOnceWith({ type: 'togglePlayback' }));
        } finally {
            window.removeEventListener('keydown', windowKeydown);
            commandIntent.mockRestore();
        }
    });

    it('allows the palette shortcut from navigator search like a normal input', () => {
        registerHandlerMap({ togglePlayback: togglePlaybackHandler });
        act(() => workspaceStore.set({ ...defaultWorkspaceState, commandPaletteOpen: false }));
        render(
            <>
                <ShortcutHost />
                <input aria-label="ordinary input" />
            </>
        );
        const ordinary = screen.getByRole('textbox', { name: 'ordinary input' });
        fireEvent.keyDown(ordinary, { key: 'k', code: 'KeyK', metaKey: true });
        expect(workspaceStore.value?.commandPaletteOpen).toBe(true);

        act(() => workspaceStore.set({ ...defaultWorkspaceState, commandPaletteOpen: false }));
        openNavigator();
        const search = screen.getByRole('searchbox', { name: 'Search clips' });
        fireEvent.keyDown(search, { key: 'k', code: 'KeyK', metaKey: true });
        expect(workspaceStore.value?.commandPaletteOpen).toBe(true);
    });

    it('keeps an Elastic marker intact when Delete is pressed in the timeline listbox', async () => {
        const audioClip: Clip = { ...clip('one', 'voice', 0), type: 'audio' };
        act(() => trackStore.set({ ...defaultTrackState, tracks: [track('voice', 'Voice', [audioClip])] }));
        registerHandlerMap(getFinalFeatureHandlers());
        await act(async () => {
            await commandUseCases.executeAppAction({ type: 'openElasticEditor', payload: { clipId: 'one' } });
            await commandUseCases.executeAppAction({
                type: 'elasticAddMarker',
                payload: { clipId: 'one', localBeat: 1 },
            });
        });
        const before = structuredClone(getWarpState('one').markers);
        expect(before).toHaveLength(1);
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        render(<ElasticEditorPanel />);
        const canvas = screen.getByTestId('elastic-waveform-canvas');
        canvas.setPointerCapture = vi.fn();
        fireEvent.pointerDown(canvas, { clientX: 40, pointerId: 4 });
        expect(elasticAudioStore.value?.selectedMarkerIds).toEqual([before[0]?.id]);
        const details = screen.getByTestId('elastic-detail-strip');
        expect(details).toHaveTextContent('0 transients, 1 user, 0 locked');

        const listbox = openNavigator();
        expect(screen.getByRole('searchbox', { name: 'Search clips' })).toHaveFocus();
        fireEvent.keyDown(listbox, { key: 'Delete' });
        fireEvent.keyDown(listbox, { key: 'Backspace' });

        expect(getWarpState('one').markers).toEqual(before);
        expect(details).toHaveTextContent('0 transients, 1 user, 0 locked');
    });

    it('steps to the previous result when ArrowUp is pressed in the search field', () => {
        act(() => {
            trackStore.set({
                ...defaultTrackState,
                tracks: [
                    track('voice', 'Voice', [
                        clip('one', 'voice', 0, 'One'),
                        clip('two', 'voice', 4, 'Two'),
                        clip('three', 'voice', 8, 'Three'),
                    ]),
                ],
            });
        });
        const listbox = openNavigator();
        const search = screen.getByRole('searchbox', { name: 'Search clips' });
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        fireEvent.keyDown(listbox, { key: 'ArrowDown' });
        expect(activeOption(listbox)).toHaveAccessibleName(/Three, Voice/);

        act(() => search.focus());
        fireEvent.keyDown(search, { key: 'ArrowUp' });

        expect(activeOption(listbox)).toHaveAccessibleName(/Two, Voice/);
        expect(listbox).toHaveFocus();
        fireEvent.keyDown(listbox, { key: 'Enter' });
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['two']);
    });

    it('filters clip and track names by type and current track with announced counts', () => {
        const audioTake: Clip = { ...clip('take', 'voice', 4, 'Take'), type: 'audio' };
        act(() => {
            trackStore.set({
                ...defaultTrackState,
                selectedTrackId: 'voice',
                tracks: [
                    track('voice', 'Voice', [clip('lead', 'voice', 0, 'Lead'), audioTake]),
                    track('drums', 'Drums', [clip('fill', 'drums', 8, 'Fill')]),
                ],
            });
        });
        const listbox = openNavigator();
        const search = screen.getByRole('searchbox', { name: 'Search clips' });
        expect(screen.getByText('3 of 3 clips')).toBeInTheDocument();

        fireEvent.change(search, { target: { value: 'drums' } });
        expect(within(listbox).getAllByRole('option')).toHaveLength(1);
        expect(activeOption(listbox)).toHaveAccessibleName(/Fill, Drums, MIDI clip/);
        expect(screen.getByText('1 of 3 clips')).toBeInTheDocument();

        fireEvent.change(search, { target: { value: 'TAK' } });
        expect(within(listbox).getAllByRole('option')).toHaveLength(1);
        expect(activeOption(listbox)).toHaveAccessibleName(/Take, Voice, audio clip/);
        expect(screen.getByText('1 of 3 clips')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'MIDI' }));
        expect(within(listbox).queryAllByRole('option')).toHaveLength(0);
        expect(screen.getByText('No matching clips')).toBeInTheDocument();
        expect(screen.getByText('0 of 3 clips')).toBeInTheDocument();
        expect(listbox).not.toHaveAttribute('aria-activedescendant');

        fireEvent.change(search, { target: { value: '' } });
        expect(
            within(listbox)
                .getAllByRole('option')
                .map((option) => option.textContent)
        ).toEqual(['Lead · Voice', 'Fill · Drums']);
        fireEvent.click(screen.getByRole('button', { name: 'Current track' }));
        expect(within(listbox).getAllByRole('option')).toHaveLength(1);
        expect(activeOption(listbox)).toHaveAccessibleName(/Lead, Voice, MIDI clip/);
        expect(screen.getByText('1 of 3 clips')).toBeInTheDocument();
        expect(trackStore.value?.selectedTrackId).toBe('voice');
        expect(clipSelectionStore.value?.selectedClipIds).toEqual([]);

        act(() => trackStore.set({ ...trackStore.value!, selectedTrackId: null }));
        expect(screen.getByRole('button', { name: 'Current track' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Current track' })).toHaveAttribute('aria-pressed', 'false');
        expect(within(listbox).getAllByRole('option')).toHaveLength(2);
        expect(screen.getByText('2 of 3 clips')).toBeInTheDocument();

        fireEvent.keyDown(search, { key: 'Escape' });
        expect(screen.queryByRole('listbox', { name: 'Timeline clips' })).not.toBeInTheDocument();
    });

    it('selects and minimally reveals an off-screen result without changing zoom', () => {
        act(() => {
            trackStore.set({
                ...defaultTrackState,
                tracks: [
                    track('near-track', 'Near', [clip('near', 'near-track', 0, 'Near')]),
                    track('far-track', 'Far', [clip('far', 'far-track', 100, 'Far')]),
                ],
            });
            selectClipWithFocus('near');
            timelineViewStore.set({
                scrollX: 0,
                scrollY: 0,
                pixelsPerBeat: 10,
                autoScrollEnabled: true,
                viewportHeight: 80,
                viewportWidth: 200,
            });
        });
        const listbox = openNavigator();
        const search = screen.getByRole('searchbox', { name: 'Search clips' });
        fireEvent.change(search, { target: { value: 'Far' } });

        fireEvent.keyDown(search, { key: 'Enter' });

        expect(trackStore.value?.selectedTrackId).toBe('far-track');
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['far']);
        expect(timelineViewStore.value).toMatchObject({
            scrollX: 820,
            scrollY: 80,
            pixelsPerBeat: 10,
        });
        const clipStartX = 100 * 10;
        const clipEndX = 102 * 10;
        const { scrollX = 0, scrollY = 0 } = timelineViewStore.value ?? {};
        expect(clipStartX).toBeGreaterThanOrEqual(scrollX);
        expect(clipEndX).toBeLessThanOrEqual(scrollX + 200);
        expect(80).toBeGreaterThanOrEqual(scrollY);
        expect(160).toBeLessThanOrEqual(scrollY + 80);
        expect(screen.getByRole('listbox', { name: 'Timeline clips' })).toBe(listbox);

        fireEvent.keyDown(search, { key: 'Enter' });
        expect(timelineViewStore.value).toMatchObject({ scrollX: 820, scrollY: 80, pixelsPerBeat: 10 });
    });

    it('keeps the viewport when an oversized clip and track already cover it', () => {
        act(() => {
            trackStore.set({
                ...defaultTrackState,
                tracks: [
                    track('target-track', 'Target', [{ ...clip('target', 'target-track', 0), endBeat: 100 }], {
                        height: 1000,
                    }),
                ],
            });
            timelineViewStore.set({
                scrollX: 500,
                scrollY: 500,
                pixelsPerBeat: 10,
                autoScrollEnabled: true,
                viewportHeight: 100,
                viewportWidth: 100,
            });
        });
        openNavigator();
        fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search clips' }), { key: 'Enter' });
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['target']);
        expect(timelineViewStore.value).toMatchObject({ scrollX: 500, scrollY: 500 });
    });

    it('minimally reveals the clipped edge of oversized results', () => {
        act(() => {
            trackStore.set({
                ...defaultTrackState,
                tracks: [
                    ...Array.from({ length: 4 }, (_, index) =>
                        track(`before-${index}`, `Before ${index}`, [], { height: 100 })
                    ),
                    track('target-track', 'Target', [{ ...clip('target', 'target-track', 20), endBeat: 55 }], {
                        height: 150,
                    }),
                    ...Array.from({ length: 5 }, (_, index) => track(`after-${index}`, `After ${index}`, [])),
                ],
            });
            timelineViewStore.set({
                scrollX: 500,
                scrollY: 500,
                pixelsPerBeat: 10,
                autoScrollEnabled: true,
                viewportHeight: 100,
                viewportWidth: 100,
            });
        });
        openNavigator();
        fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search clips' }), { key: 'Enter' });
        expect(timelineViewStore.value).toMatchObject({ scrollX: 450, scrollY: 450 });
    });

    it('reveals oversized results that are fully before the viewport', () => {
        act(() => {
            trackStore.set({
                ...defaultTrackState,
                tracks: [
                    ...Array.from({ length: 2 }, (_, index) =>
                        track(`before-${index}`, `Before ${index}`, [], { height: 100 })
                    ),
                    track('target-track', 'Target', [{ ...clip('target', 'target-track', 20), endBeat: 40 }], {
                        height: 300,
                    }),
                    ...Array.from({ length: 8 }, (_, index) => track(`after-${index}`, `After ${index}`, [])),
                ],
            });
            timelineViewStore.set({
                scrollX: 500,
                scrollY: 500,
                pixelsPerBeat: 10,
                autoScrollEnabled: true,
                viewportHeight: 100,
                viewportWidth: 100,
            });
        });
        openNavigator();
        fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search clips' }), { key: 'Enter' });
        expect(timelineViewStore.value).toMatchObject({ scrollX: 300, scrollY: 400 });
    });

    it('minimally reveals oversized results clipped beyond the viewport end', () => {
        act(() => {
            trackStore.set({
                ...defaultTrackState,
                tracks: [
                    ...Array.from({ length: 5 }, (_, index) =>
                        track(`before-${index}`, `Before ${index}`, [], { height: 110 })
                    ),
                    track('target-track', 'Target', [{ ...clip('target', 'target-track', 55), endBeat: 100 }], {
                        height: 450,
                    }),
                    ...Array.from({ length: 5 }, (_, index) => track(`after-${index}`, `After ${index}`, [])),
                ],
            });
            timelineViewStore.set({
                scrollX: 500,
                scrollY: 500,
                pixelsPerBeat: 10,
                autoScrollEnabled: true,
                viewportHeight: 100,
                viewportWidth: 100,
            });
        });
        openNavigator();
        fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search clips' }), { key: 'Enter' });
        expect(timelineViewStore.value).toMatchObject({ scrollX: 550, scrollY: 550 });
    });

    it('minimally reveals a clip before an already scrolled viewport', () => {
        act(() => {
            trackStore.set({
                ...defaultTrackState,
                tracks: Array.from({ length: 10 }, (_, index) =>
                    track(
                        `track-${index}`,
                        `Track ${index}`,
                        index === 4 ? [clip('target', 'track-4', 30, 'Target')] : []
                    )
                ),
            });
            timelineViewStore.set({
                scrollX: 500,
                scrollY: 500,
                pixelsPerBeat: 10,
                autoScrollEnabled: true,
                viewportHeight: 200,
                viewportWidth: 100,
            });
        });
        openNavigator();
        fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search clips' }), { key: 'Enter' });
        expect(timelineViewStore.value).toMatchObject({ scrollX: 300, scrollY: 320 });
    });

    it('retargets a filtered active descendant after deletion and undo restoration', () => {
        const first = clip('first', 'voice', 0, 'Keep A');
        const second = clip('second', 'voice', 4, 'Keep B');
        act(() => trackStore.set({ ...defaultTrackState, tracks: [track('voice', 'Voice', [first, second])] }));
        const listbox = openNavigator();
        const search = screen.getByRole('searchbox', { name: 'Search clips' });
        fireEvent.change(search, { target: { value: 'Keep' } });
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        fireEvent.keyDown(listbox, { key: 'End' });
        expect(activeOption(listbox)).toHaveAccessibleName(/Keep B/);

        act(() => trackStore.set({ ...defaultTrackState, tracks: [track('voice', 'Voice', [first])] }));
        expect(activeOption(listbox)).toHaveAccessibleName(/Keep A/);
        expect(document.getElementById(listbox.getAttribute('aria-activedescendant')!)).toBeInTheDocument();

        act(() => trackStore.set({ ...defaultTrackState, tracks: [track('voice', 'Voice', [first, second])] }));
        fireEvent.keyDown(listbox, { key: 'End' });
        expect(activeOption(listbox)).toHaveAccessibleName(/Keep B/);
        act(() => trackStore.set({ ...defaultTrackState, tracks: [] }));
        expect(screen.getByText('No clips')).toBeInTheDocument();
        expect(listbox).not.toHaveAttribute('aria-activedescendant');
    });
});

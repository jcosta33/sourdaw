import { type ReactNode } from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track } from '../../../models/Track';
import { selectTrack } from '../../../useCases/toggleTrackState/selectTrack';
import { useTracks } from '../../hooks/useTracks';
import { TrackListView } from '../TrackListView';

// The real TrackHeader renders inside the real track-list row; only leaf editors, menus and use cases are cut.
vi.unmock('#/components/ui/tooltip');

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(function useStoreMock<Value>(_store: unknown, defaultValue: Value): Value {
        return defaultValue;
    }),
}));

vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({ tracks: [], selectedTrackId: null })),
}));

vi.mock('../../hooks/useTrackMuteToggle', () => ({
    useTrackMuteToggle: () => vi.fn(() => Promise.resolve()),
}));

vi.mock('../MiniMasterSpectrum', () => ({
    MiniMasterSpectrum: () => null,
}));

vi.mock('../TrackContextMenu', () => ({
    TrackContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../TrackHeader/InlineTrackName', () => ({
    InlineTrackName: ({ track }: { track: Track }) => <span>{track.name}</span>,
}));
vi.mock('../TrackHeader/ResizeHandle', () => ({ ResizeHandle: () => null }));
vi.mock('../TrackHeader/InputSelector', () => ({ InputSelector: () => null }));
vi.mock('../TrackHeader/TrackLevelIndicator', () => ({ TrackLevelIndicator: () => null }));
vi.mock('../TrackHeader/LevainLoadingSpinner', () => ({ LevainLoadingSpinner: () => null }));

vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({
    selectTrack: vi.fn(),
}));
vi.mock('../../../useCases/toggleTrackState/soloTrack', () => ({ soloTrack: vi.fn() }));
vi.mock('../../../useCases/toggleTrackState/soloTrackExclusive', () => ({ soloTrackExclusive: vi.fn() }));
vi.mock('../../../useCases/toggleTrackState/toggleVariationLanes', () => ({ toggleVariationLanes: vi.fn() }));
vi.mock('../../../useCases/folder/toggleFolderCollapse', () => ({ toggleFolderCollapse: vi.fn() }));
vi.mock('../../../useCases/setTrackGainPan/setInputMonitoring', () => ({ setInputMonitoring: vi.fn() }));
vi.mock('../../../useCases/addTrack', () => ({ addTrack: vi.fn() }));
vi.mock('../../../useCases/removeTrack', () => ({ removeTrack: vi.fn() }));
vi.mock('../../../useCases/getTrackTemplates', () => ({ getTrackTemplates: vi.fn(() => []) }));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {
        getSnapshot: () => ({ scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true, viewportHeight: 0 }),
        subscribeReact: () => () => {},
    },
    setScrollY: vi.fn(),
    setTimelineViewportHeight: vi.fn(),
}));

vi.mock('#/modules/Preferences/stores', () => ({ preferencesStore: {} }));
vi.mock('#/modules/Preferences/useCases', () => ({
    defaultPreferences: { trackHeight: 'normal' },
    onSoloModePreferenceApplied: vi.fn(),
    setTrackHeight: vi.fn(),
    updatePreferences: vi.fn(),
}));
vi.mock('#/modules/AiRuntime/useCases', () => ({ injectPromptDraft: vi.fn() }));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
}));
vi.mock('#/modules/WorkspaceShell/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/WorkspaceShell/useCases')>()),
    setWorkspaceMode: vi.fn(),
}));
vi.mock('#/utils/Notification/confirmUser', () => ({ confirmUser: vi.fn() }));

const audioTrack = TrackDummy.create({ id: 'audio1', name: 'Audio One', kind: 'audio', height: 64 });
const folderTrack = TrackDummy.create({ id: 'folder1', name: 'Folder One', kind: 'folder', height: 26 });
const selectedTrack = TrackDummy.create({ id: 'selected', name: 'Selected', kind: 'midi', height: 64 });

const renderList = (tracks: Track[]): void => {
    vi.mocked(useTracks).mockReturnValue({ tracks: [selectedTrack, ...tracks], selectedTrackId: 'selected' });
    render(
        <TooltipProvider>
            <TrackListView />
        </TooltipProvider>
    );
};

const failedFreeze = (track: Track): Track => ({
    ...track,
    freezeState: { status: 'error', errorMessage: 'Render failed' },
});

const expectSelectedOnceBy = (name: string, trackId: string): void => {
    fireEvent.click(screen.getByText(name));
    expect(selectTrack).toHaveBeenCalledTimes(1);
    expect(selectTrack).toHaveBeenCalledWith(trackId);
};

describe('TrackListView row selection through the track header', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        ['audio', audioTrack],
        ['folder', folderTrack],
    ] as const)('selects a %s track exactly once when its header is clicked', (_kind, track) => {
        renderList([track]);
        expectSelectedOnceBy(track.name, track.id);
    });

    it.each([
        ['Variation lanes for Audio One'],
        ['Input monitoring for Audio One: Auto'],
        ['Arm Audio One'],
        ['Mute Audio One'],
        ['Solo Audio One'],
    ])('keeps the selection when the "%s" header control is clicked', (label) => {
        renderList([audioTrack]);
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(selectTrack).not.toHaveBeenCalled();

        expectSelectedOnceBy(audioTrack.name, audioTrack.id);
    });

    it('keeps the selection when a folder is collapsed from its header', () => {
        renderList([folderTrack]);
        fireEvent.click(screen.getByRole('button', { name: 'Collapse folder Folder One' }));
        expect(selectTrack).not.toHaveBeenCalled();

        expectSelectedOnceBy(folderTrack.name, folderTrack.id);
    });

    it.each([
        ['audio', audioTrack],
        ['folder', folderTrack],
    ] as const)('keeps the selection when the %s freeze error is activated', (_kind, track) => {
        renderList([failedFreeze(track)]);
        const badge = screen.getByRole('button', { name: 'Freeze error: Render failed' });
        fireEvent.click(badge, { detail: 1 });
        expect(selectTrack).not.toHaveBeenCalled();

        act(() => badge.focus());
        expect(badge).toHaveFocus();
        fireEvent.keyDown(badge, { key: 'Enter' });
        // jsdom does not synthesize the native click for a keyboard-activated button.
        fireEvent.click(badge, { detail: 0 });
        fireEvent.keyUp(badge, { key: 'Enter' });
        expect(selectTrack).not.toHaveBeenCalled();

        expectSelectedOnceBy(track.name, track.id);
    });
});

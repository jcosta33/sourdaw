import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    clipSelectionStore,
    defaultClipSelectionState,
    defaultTrackState,
    trackStore,
    type Clip,
} from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { automationStore, type AutomationLane } from '#/modules/Automation/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';

import { CommandPalette } from '../CommandPalette';

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
}));

const clip: Clip = {
    id: 'clip',
    trackId: 'track',
    name: 'Clip',
    startBeat: 0,
    endBeat: 2,
    type: 'midi',
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#ffffff',
    locked: false,
    muted: false,
};
const lane: AutomationLane = {
    id: 'lane',
    trackId: 'track',
    parameterId: 'gain',
    parameterName: 'Gain',
    points: [],
    objects: [],
    visible: true,
    enabled: true,
    collapsed: false,
    minValue: 0,
    maxValue: 1,
};

function setClips(clips: Clip[]): void {
    const track = createTrack({ id: 'track', name: 'Track', kind: 'midi', withoutDefaultDevice: true });
    trackStore.set({ ...defaultTrackState, tracks: [{ ...track, clips }] });
}

function search(query: string): HTMLElement {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: query } });
    return screen.getByRole('option', { name: new RegExp(query) });
}

describe('CommandPalette live context', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workspaceStore.set({ ...defaultWorkspaceState, commandPaletteOpen: true });
        setClips([clip]);
        clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipId: clip.id, selectedClipIds: [clip.id] });
        automationStore.set({ lanes: [] });
    });

    afterEach(() => {
        cleanup();
        workspaceStore.set(defaultWorkspaceState);
        trackStore.set(defaultTrackState);
        clipSelectionStore.set(defaultClipSelectionState);
        automationStore.set({ lanes: [] });
    });

    it('refreshes availability when the selected clip disappears, without changing the selection store', () => {
        render(<CommandPalette />);
        const option = search('Quantize Notes');
        expect(option).toHaveAttribute('aria-disabled', 'false');

        act(() => setClips([]));

        expect(option).toHaveAttribute('aria-disabled', 'true');
        expect(option).toHaveAccessibleName(/Select a MIDI clip first/);
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
        expect(executeUserAppAction).not.toHaveBeenCalled();
    });

    it('rechecks live context before dispatch even before the displayed snapshot refreshes', () => {
        render(<CommandPalette />);
        const option = search('Quantize Notes');
        expect(option).toHaveAttribute('aria-disabled', 'false');
        act(() => {
            setClips([]);
            fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
        });
        expect(executeUserAppAction).not.toHaveBeenCalled();
        expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('refreshes when selection alone changes and keeps wrong-kind clips unavailable', () => {
        setClips([clip, { ...clip, id: 'audio', type: 'audio' }]);
        render(<CommandPalette />);
        const option = search('Quantize Notes');
        expect(option).toHaveAttribute('aria-disabled', 'false');

        act(() =>
            clipSelectionStore.set({
                ...defaultClipSelectionState,
                selectedClipId: 'audio',
                selectedClipIds: ['audio'],
            })
        );
        expect(option).toHaveAttribute('aria-disabled', 'true');
        expect(option).toHaveAccessibleName(/Select a MIDI clip first/);

        act(() =>
            clipSelectionStore.set({
                ...defaultClipSelectionState,
                selectedClipId: clip.id,
                selectedClipIds: [clip.id],
            })
        );
        expect(option).toHaveAttribute('aria-disabled', 'false');
    });

    it('refreshes automation availability as lanes appear and disappear', () => {
        render(<CommandPalette />);
        const option = search('Scale Automation');
        expect(option).toHaveAttribute('aria-disabled', 'true');
        act(() => automationStore.set({ lanes: [lane] }));
        expect(option).toHaveAttribute('aria-disabled', 'false');
        act(() => automationStore.set({ lanes: [] }));
        expect(option).toHaveAttribute('aria-disabled', 'true');
        expect(option).toHaveAccessibleName(/Create an automation lane first/);
    });
});

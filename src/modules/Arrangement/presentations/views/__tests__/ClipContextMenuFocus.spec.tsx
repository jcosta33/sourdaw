import { type ReactElement, useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { clipSelectionStore, defaultClipSelectionState } from '../../../stores/clipSelectionStore';
import { ClipContextMenu } from '../ClipContextMenu';

// useStore reads via getSnapshot(); clipSelectionStore must reflect clipSelectionStore.set() in tests.
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { getSnapshot?: () => unknown; value?: unknown }, defaultValue: unknown) => {
        const snap = typeof store.getSnapshot === 'function' ? store.getSnapshot() : store.value;
        return snap ?? defaultValue;
    }),
}));

vi.mock('../../../stores/trackStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/trackStore')>();
    const { createTrack } = await import('../../../models/Track');
    const value: typeof actual.trackStore.value = {
        tracks: [
            {
                ...createTrack({
                    id: 't1',
                    name: 'Track 1',
                    kind: 'audio',
                    color: '#808080',
                    initialAlternativeId: 'alt-1',
                    withoutDefaultDevice: true,
                }),
                clips: [
                    {
                        id: 'clip1',
                        trackId: 't1',
                        name: 'Test',
                        type: 'audio',
                        startBeat: 0,
                        endBeat: 4,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#808080',
                        locked: false,
                        muted: false,
                    },
                ],
            },
        ],
        selectedTrackId: null,
    };

    return {
        ...actual,
        trackStore: {
            ...actual.trackStore,
            value,
            getSnapshot: () => value,
        },
    };
});

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: vi.fn(),
    executeUserAppAction: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    detectTempo: vi.fn(),
    detectKey: vi.fn(),
    describeDetectedKey: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/useCases', () => ({
    handleAiDenoiseClip: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    runAiActionWithToast: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/muteClip', () => ({
    muteClip: vi.fn(),
}));

// Deliberately NOT mocked: `DawContextMenuSurface` (the focus contract under
// test) and `useContextMenuDismiss` (the Escape / outside-click dismissal the
// focus restore must not break).

type MenuHarnessProps = {
    onClose: () => void;
};

const MenuHarness = ({ onClose }: MenuHarnessProps): ReactElement => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div>
            <button data-testid="prior-control" type="button">
                Play
            </button>
            <div data-testid="timeline" onContextMenu={() => setIsOpen(true)}>
                timeline
            </div>
            {isOpen ? (
                <ClipContextMenu
                    clipId="clip1"
                    onClose={() => {
                        onClose();
                        setIsOpen(false);
                    }}
                    splitBeat={2}
                    x={10}
                    y={20}
                />
            ) : null}
        </div>
    );
};

describe('ClipContextMenu focus management', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipIds: [] });
    });

    it('opens focused on right-click, dismisses on Escape, and returns focus to the prior element', () => {
        const onClose = vi.fn();
        render(<MenuHarness onClose={onClose} />);

        const priorControl = screen.getByTestId('prior-control');
        priorControl.focus();
        fireEvent.contextMenu(screen.getByTestId('timeline'));

        const menu = screen.getByRole('menu');
        expect(menu).toHaveFocus();

        // Focus inside the surface makes the Escape keydown originate inside
        // the gated role="menu" element; the document-level dismiss listener
        // in useContextMenuDismiss must still receive it.
        fireEvent.keyDown(menu, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(priorControl).toHaveFocus();
    });

    it('returns focus to the prior element when a menu action closes the menu', () => {
        const onClose = vi.fn();
        render(<MenuHarness onClose={onClose} />);

        const priorControl = screen.getByTestId('prior-control');
        priorControl.focus();
        fireEvent.contextMenu(screen.getByTestId('timeline'));

        expect(screen.getByRole('menu')).toHaveFocus();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Mute Clip' }));

        expect(onClose).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(priorControl).toHaveFocus();
    });
});

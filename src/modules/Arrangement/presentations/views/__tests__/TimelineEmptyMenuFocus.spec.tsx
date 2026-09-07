import { type ReactElement, useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { TimelineEmptyMenu } from '../TimelineEmptyMenu';

// Deliberately NOT mocked: `DawContextMenuSurface` (whose focus management must
// receive the parent's close callback) and `useContextMenuDismiss`.

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { getSnapshot?: () => unknown; value?: unknown }, defaultValue: unknown) => {
        const snap = typeof store.getSnapshot === 'function' ? store.getSnapshot() : store.value;
        return snap ?? defaultValue;
    }),
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        value: { tracks: [] },
    },
}));

vi.mock('../../../stores/markerStore', () => ({
    markerStore: {
        value: { markers: [], sections: [] },
    },
    defaultMarkerStoreState: { markers: [], sections: [] },
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: { value: { tempo: 120 } },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
}));

vi.mock('../../../useCases/importMidiFile', () => ({
    importMidiFile: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFile: vi.fn(),
    discardDecodedAudioFile: vi.fn(),
}));

vi.mock('#/modules/Project/useCases', () => ({
    captureProjectTransitionAuthority: vi.fn(),
}));

vi.mock('../../../useCases/clipboard/pasteClip', () => ({
    pasteClip: vi.fn(),
}));

vi.mock('../../../useCases/addTrack', () => ({
    addTrack: vi.fn(),
}));

vi.mock('../../../useCases/clip/addClip', () => ({
    addClip: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/removeMarker', () => ({
    removeMarker: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/setMarkerColor', () => ({
    setMarkerColor: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/addMarker', () => ({
    addMarker: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

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
                <TimelineEmptyMenu
                    beat={4}
                    onClose={() => {
                        onClose();
                        setIsOpen(false);
                    }}
                    trackId={null}
                    x={10}
                    y={20}
                />
            ) : null}
        </div>
    );
};

describe('TimelineEmptyMenu focus management', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('closes through the parent onClose when focus leaves the timeline-empty menu surface', () => {
        const onClose = vi.fn();
        render(
            <TooltipProvider>
                <MenuHarness onClose={onClose} />
            </TooltipProvider>
        );

        const priorControl = screen.getByTestId('prior-control');
        priorControl.focus();
        fireEvent.contextMenu(screen.getByTestId('timeline'));

        const menu = screen.getByRole('menu');
        expect(menu).toHaveFocus();

        // The surface must hold the parent's close callback: a focusout with
        // no inside related target is the surface closing itself, so the
        // timeline-empty menu cannot stay open behind ungated keydowns.
        fireEvent.focusOut(menu, { relatedTarget: document.createElement('button') });

        expect(onClose).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(priorControl).toHaveFocus();
    });
});

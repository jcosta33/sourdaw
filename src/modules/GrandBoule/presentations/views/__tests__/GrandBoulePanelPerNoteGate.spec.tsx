import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Container } from '#/infra/di/Container';

import { resetGrandBouleStores } from '../../../stores/grandBouleStore';
import { GrandBouleEventBus, setGrandBouleEventBus } from '../../../useCases/grandBouleEventBus';
import { GrandBoulePanel } from '../GrandBoulePanel';

// Mount the panel on typed defaults without the global useStore blob.
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

// The per-note editor is the surface under test; a marker lets us assert its
// presence/absence precisely regardless of the panel's other controls.
vi.mock('../../components/PerNoteEditor', () => ({
    PerNoteEditor: () => <div data-testid="per-note-editor" />,
}));

// The panel subscribes to a MIDI event bus on mount; a silent bus lets it
// mount without wiring real transports.
class SilentEventBus extends GrandBouleEventBus {
    emit(): Promise<void> {
        return Promise.resolve();
    }

    on(): () => void {
        return () => {};
    }
}

describe('GrandBoulePanel per-note honest surface (MD-2)', () => {
    beforeEach(() => {
        Container.clear();
        setGrandBouleEventBus(new SilentEventBus());
        resetGrandBouleStores();
    });

    it('withholds the dead per-note editor while per-note voicing is unavailable (engine set_param has no perNote.* arm)', () => {
        render(<GrandBoulePanel deviceId="gb-per-note-gate" />);
        expect(screen.queryByTestId('per-note-editor')).not.toBeInTheDocument();
    });

    it('shows an honest unavailable state in place of the per-note editor', () => {
        render(<GrandBoulePanel deviceId="gb-per-note-gate" />);
        expect(screen.getByText('Per-note voicing not yet active')).toBeInTheDocument();
    });
});

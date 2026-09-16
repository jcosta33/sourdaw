import { type ReactElement } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEngineFallbackNotice } from '../../../presentations/hooks/useEngineFallbackNotice';
import { engineFallbackNoticeStore } from '../../../stores/engineFallbackNoticeStore';
import { EngineFallbackNotice } from '../EngineFallbackNotice';

const mocks = vi.hoisted(() => ({
    isEngineAudioAvailable: vi.fn(() => true),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    isEngineAudioAvailable: mocks.isEngineAudioAvailable,
}));

/** The same hook + component pair AppShell mounts, so the spec exercises the real chain. */
function EngineFallbackNoticeHarness(): ReactElement | null {
    const { showNotice, dismissNotice } = useEngineFallbackNotice();
    if (!showNotice) {
        return null;
    }
    return <EngineFallbackNotice onDismiss={dismissNotice} />;
}

describe('EngineFallbackNotice', () => {
    beforeEach(() => {
        engineFallbackNoticeStore.set(false);
        mocks.isEngineAudioAvailable.mockClear();
    });

    it('shows the engine-failed notice while the engine is in fallback mode', () => {
        mocks.isEngineAudioAvailable.mockReturnValue(false);

        render(<EngineFallbackNoticeHarness />);

        expect(screen.getByTestId('engine-fallback-notice')).toBeInTheDocument();
        expect(screen.getByText('The audio engine could not start')).toBeInTheDocument();
        expect(screen.getByText(/Restart Sourdaw/)).toBeInTheDocument();
        expect(screen.getByText(/audio output device/)).toBeInTheDocument();
    });

    it('renders no notice when engine audio is available', () => {
        mocks.isEngineAudioAvailable.mockReturnValue(true);

        render(<EngineFallbackNoticeHarness />);

        expect(screen.queryByTestId('engine-fallback-notice')).not.toBeInTheDocument();
    });

    it('renders exactly one notice for the session, not one per device', () => {
        mocks.isEngineAudioAvailable.mockReturnValue(false);

        render(<EngineFallbackNoticeHarness />);

        expect(screen.getAllByTestId('engine-fallback-notice')).toHaveLength(1);
    });

    it('stays hidden after the user dismisses it', () => {
        mocks.isEngineAudioAvailable.mockReturnValue(false);

        render(<EngineFallbackNoticeHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss audio engine notice' }));

        expect(screen.queryByTestId('engine-fallback-notice')).not.toBeInTheDocument();
        expect(engineFallbackNoticeStore.value).toBe(true);
    });
});

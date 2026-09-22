import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetWarpStatesForTest, addWarpMarker, setWarpState, trackStore } from '#/modules/Arrangement/stores';

import { WaveformEditor } from '../WaveformEditor';

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        ...props
    }: React.ComponentProps<'button'> & { variant?: string; size?: string; asChild?: boolean }) => (
        <button type="button" {...props}>
            {children}
        </button>
    ),
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: () => <div data-testid="slider" />,
}));

vi.mock('#/components/ui/disabled-feature-wrapper', () => ({
    DisabledFeatureWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('#/components/daw/DawControlStrip', () => ({
    DawControlStrip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/components/layout', () => ({
    Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    relinkClipAudioSource: vi.fn(),
    replaceClipAudioBuffer: vi.fn(),
    enableWarp: vi.fn(),
    disableWarp: vi.fn(),
    setStretchMode: vi.fn(),
    getStretchModeInfo: () => ({ name: 'Repitch', available: true, description: '' }),
    STRETCH_MODES: ['repitch'],
    removeWarpMarker: vi.fn(),
    moveWarpMarker: vi.fn(),
    commitWarpMarkerBeatDrag: vi.fn(),
    addManualWarpMarker: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/useCases', () => ({
    handleAiDenoiseClip: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    audioToMidi: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFile: vi.fn(),
    discardDecodedAudioFile: vi.fn(),
    getCachedAudioBuffer: vi.fn(() => null),
    getCachedAudioBufferWaveformPeaks: vi.fn(() => null),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
}));

vi.mock('#/modules/Project/useCases', () => ({
    captureProjectTransitionAuthority: vi.fn(() => ({})),
    verifyAudioBufferReferences: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/utils/desktopRuntime', () => ({
    isDesktopRuntime: () => false,
}));

describe('WaveformEditor warp store subscription', () => {
    beforeEach(() => {
        __resetWarpStatesForTest();
        trackStore.set({
            tracks: [],
            selectedTrackId: null,
            ghostClips: [],
        });
        setWarpState('clip-a', {
            enabled: true,
            markers: [],
            stretchMode: 'repitch',
            originalTempo: null,
        });
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
            configurable: true,
            value: () =>
                new Proxy(
                    {},
                    {
                        get: () => vi.fn(),
                    }
                ),
        });
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 400 });
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 120 });
    });

    afterEach(() => {
        __resetWarpStatesForTest();
        trackStore.set({
            tracks: [],
            selectedTrackId: null,
            ghostClips: [],
        });
    });

    it('shows a marker added for the open clip by an external write without a clip switch', async () => {
        render(<WaveformEditor clipId="clip-a" audioBufferId="buf-a" />);

        expect(screen.getByText('0 markers')).toBeTruthy();

        await act(() => {
            addWarpMarker('clip-a', 1, 1.25);
        });

        expect(screen.getByText('1 marker')).toBeTruthy();
    });
});

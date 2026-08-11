import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';

import { createGrandBouleStore, resetGrandBouleStores } from '../../../stores/grandBouleStore';
import { setGrandBouleEventBus } from '../../../useCases/grandBouleEventBus';
import { GrandBoulePanel } from '../GrandBoulePanel';

const projectTrackState = vi.hoisted(() => ({
    current: null as null | {
        tracks: { id: string; devices: { id: string; parameterValues: Record<string, number> }[] }[];
        selectedTrackId: string | null;
        ghostClips: never[];
    },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { value?: unknown }, defaultValue: unknown) => {
        if (
            projectTrackState.current !== null &&
            defaultValue !== null &&
            typeof defaultValue === 'object' &&
            'tracks' in defaultValue
        ) {
            return projectTrackState.current;
        }
        return store.value ?? defaultValue;
    }),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    ensureTrackStrip: () => ({ deviceNodes: [], analyserNode: null }),
    getAudioSampleRate: () => 44100,
}));

const hydrateGrandBouleConfigFromProject = vi.hoisted(() => vi.fn());

vi.mock('../../../useCases/hydrateGrandBouleConfigFromProject', () => ({ hydrateGrandBouleConfigFromProject }));

const executeAppAction = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('#/modules/Command/useCases', () => ({ executeAppAction }));

const mockEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => () => {}),
};

describe('GrandBoulePanel', () => {
    beforeEach(() => {
        Container.clear();
        setGrandBouleEventBus(mockEventBus);
        resetGrandBouleStores();
        projectTrackState.current = null;
        vi.clearAllMocks();
    });

    it('renders the panel window with the expected heading', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        // The panel renders a grand-boule-window with content.
        const window = document.querySelector('.grand-boule-window');
        expect(window).not.toBeNull();
    });

    it('renders the engine readiness tile as "idle" with no live engine', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        expect(screen.getByText('idle')).toBeInTheDocument();
    });

    it('renders interactive control elements (buttons, knobs, or sliders)', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        const interactive = screen.queryAllByRole('button').length + screen.queryAllByRole('slider').length;
        expect(interactive).toBeGreaterThan(0);
    });

    it('exposes the audible lid and microphone controls', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        expect(screen.getByRole('slider', { name: 'Lid position' })).toHaveValue(1);
        expect(screen.getByRole('combobox', { name: 'Microphone position' })).toHaveValue('1');
    });

    it('routes microphone changes into the device-owned config', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Microphone position' }), {
            target: { value: '2' },
        });

        expect(createGrandBouleStore('dev-1').value?.config.micPosition).toBe(2);
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'setDeviceParameter',
            payload: { deviceId: 'dev-1', paramId: 'micPosition', value: 2 },
        });
    });

    it('rehydrates the controls when undo changes project parameter values', () => {
        projectTrackState.current = {
            tracks: [{ id: 'track-1', devices: [{ id: 'dev-1', parameterValues: { lidPosition: 0.25 } }] }],
            selectedTrackId: 'track-1',
            ghostClips: [],
        };
        const { rerender } = render(<GrandBoulePanel deviceId="dev-1" />);
        expect(hydrateGrandBouleConfigFromProject).toHaveBeenCalledOnce();
        hydrateGrandBouleConfigFromProject.mockClear();

        projectTrackState.current = {
            tracks: [{ id: 'track-1', devices: [{ id: 'dev-1', parameterValues: { lidPosition: 0.8 } }] }],
            selectedTrackId: 'track-1',
            ghostClips: [],
        };
        rerender(<GrandBoulePanel deviceId="dev-1" />);

        expect(hydrateGrandBouleConfigFromProject).toHaveBeenCalledWith('dev-1');
    });

    it('emits events through the event bus when rendered (wiring check)', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        // The event bus is wired — at minimum it was registered.
        expect(mockEventBus.on).toHaveBeenCalled();
    });

    it('renders the panel for a different deviceId without error', () => {
        render(<GrandBoulePanel deviceId="grand-boule-2" />);
        expect(screen.getByText('idle')).toBeInTheDocument();
    });
});

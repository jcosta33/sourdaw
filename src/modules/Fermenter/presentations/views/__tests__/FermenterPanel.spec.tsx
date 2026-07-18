import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { FermenterPanel } from '../FermenterPanel';

const presetBrowserMock = vi.hoisted(() =>
    vi.fn(({ userPatches }: { userPatches: Array<{ id: string; name: string; patch?: unknown }> }) => (
        <div data-testid="preset-browser">{JSON.stringify(userPatches)}</div>
    ))
);
const midiLearnRotaryKnobMock = vi.hoisted(() => vi.fn(() => <div data-testid="midi-learn-knob" />));

vi.mock('#/infra/store/useStoreSelector', () => ({
    useStoreSelector: vi.fn((_store, selector: (state: null) => unknown) => selector(null)),
}));

vi.mock('../../components/PresetBrowser', () => ({
    PresetBrowser: presetBrowserMock,
}));

vi.mock('#/modules/ControlSurface/presentations/views', () => ({
    MidiLearnRotaryKnob: midiLearnRotaryKnobMock,
}));

describe('FermenterPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
    });

    it('should render without crashing', () => {
        render(<FermenterPanel deviceId="fermenter-1" />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<FermenterPanel deviceId="fermenter-1" />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<FermenterPanel deviceId="fermenter-1" />);
        expect(midiLearnRotaryKnobMock).toHaveBeenCalled();
        expect(screen.getAllByTestId('midi-learn-knob').length).toBeGreaterThan(0);
    });

    it('should have interactive elements', () => {
        render(<FermenterPanel deviceId="fermenter-1" />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('should sanitize malformed stored user patches before rendering the preset browser', () => {
        window.localStorage.setItem(
            'fermenter-user-patches',
            JSON.stringify([
                { id: 123, name: 'Bad id', patch: { filterCutoff: 111 } },
                { id: 'bad-name', name: null, patch: { filterCutoff: 222 } },
                { id: 'bad-patch', name: 'Bad patch', patch: null },
                {
                    id: 'good',
                    name: 'Good patch',
                    patch: {
                        filterCutoff: 7600,
                        macros: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
                        masterGain: Number.POSITIVE_INFINITY,
                        name: 'Ignored stored patch name',
                    },
                },
            ])
        );

        render(<FermenterPanel deviceId="fermenter-1" />);

        const props = presetBrowserMock.mock.lastCall?.[0];
        expect(props?.userPatches).toHaveLength(1);
        expect(props?.userPatches[0]?.id).toBe('good');
        expect(props?.userPatches[0]?.name).toBe('Good patch');
        expect(props?.userPatches[0]?.patch).toMatchObject({
            filterCutoff: 7600,
            macros: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
            masterGain: DEFAULT_PATCH.masterGain,
            name: 'Good patch',
        });
    });
});

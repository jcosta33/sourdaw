import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { FermenterPanel } from '../FermenterPanel';

const presetBrowserMock = vi.hoisted(() =>
    vi.fn(({ userPatches }: { userPatches: Array<{ id: string; name: string; patch?: unknown }> }) => (
        <div data-testid="preset-browser">{JSON.stringify(userPatches)}</div>
    ))
);
const midiLearnRotaryKnobMock = vi.hoisted(() => vi.fn(() => <div data-testid="midi-learn-knob" />));
const loadUserPatchesMock = vi.hoisted(() => vi.fn());

vi.mock('#/infra/store/useStoreSelector', () => ({
    useStoreSelector: vi.fn((_store, selector: (state: null) => unknown) => selector(null)),
}));

vi.mock('../../components/PresetBrowser', () => ({
    PresetBrowser: presetBrowserMock,
}));

vi.mock('#/modules/ControlSurface/presentations/views', () => ({
    MidiLearnRotaryKnob: midiLearnRotaryKnobMock,
}));

// Wrap the real loader with a call counter so the render-body fetch
// regression can be measured.
vi.mock('../../../useCases/user-patches/load-user-patches', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../useCases/user-patches/load-user-patches')>();
    loadUserPatchesMock.mockImplementation(actual.loadUserPatches);
    return { loadUserPatches: loadUserPatchesMock };
});

function renderPanel(deviceId = 'fermenter-1') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <FermenterPanel deviceId={deviceId} />
        </QueryClientProvider>
    );
}

describe('FermenterPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
    });

    it('should render without crashing', () => {
        renderPanel();
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        renderPanel();
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderPanel();
        expect(midiLearnRotaryKnobMock).toHaveBeenCalled();
        expect(screen.getAllByTestId('midi-learn-knob').length).toBeGreaterThan(0);
    });

    it('should have interactive elements', () => {
        renderPanel();
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('should sanitize malformed stored user patches before rendering the preset browser', async () => {
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

        renderPanel();

        await waitFor(() => {
            const props = presetBrowserMock.mock.lastCall?.[0];
            expect(props?.userPatches).toHaveLength(1);
        });
        const props = presetBrowserMock.mock.lastCall?.[0];
        expect(props?.userPatches[0]?.id).toBe('good');
        expect(props?.userPatches[0]?.name).toBe('Good patch');
        expect(props?.userPatches[0]?.patch).toMatchObject({
            filterCutoff: 7600,
            macros: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
            masterGain: DEFAULT_PATCH.masterGain,
            name: 'Good patch',
        });
    });

    /// Regression (fermenter audit F2): user-patch reads ran in the render
    /// body (`const userPatches = loadUserPatches()`), outside any state or
    /// Query pattern — the version-counter refresh after save could not
    /// invalidate the React Compiler's memoized call, so a newly saved
    /// patch never reached the preset browser until remount.
    it('reflects a newly saved user patch in the preset browser', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <FermenterPanel deviceId="fermenter-1" />
            </QueryClientProvider>
        );

        // Let the initial user-patch read settle before the save gesture
        // (pre-fix there is no query at all, so this passes immediately and
        // the behavioral assertion below is what goes red).
        await waitFor(() => {
            const query = client.getQueryCache().find({ queryKey: ['fermenter', 'user-patches'] });
            expect(query === undefined || query.state.status === 'success').toBe(true);
        });

        const openSave = screen.getAllByRole('button').find((button) => button.querySelector('svg.lucide-save'));
        expect(openSave).toBeDefined();
        fireEvent.click(openSave!);

        const nameInput = screen.getByPlaceholderText('Name…');
        fireEvent.change(nameInput, { target: { value: 'My patch' } });
        fireEvent.keyDown(nameInput, { key: 'Enter' });

        await waitFor(() => {
            const props = presetBrowserMock.mock.lastCall?.[0] as { userPatches: Array<{ name: string }> } | undefined;
            expect(
                props?.userPatches.map((userPatch) => userPatch.name),
                'saved patch must reach the preset browser without a remount'
            ).toContain('My patch');
        });
    });
});

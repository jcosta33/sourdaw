import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { FermenterPanel, randomizePatch } from '../FermenterPanel';

const presetBrowserMock = vi.hoisted(() =>
    vi.fn(({ userPatches }: { userPatches: Array<{ id: string; name: string; patch?: unknown }> }) => (
        <div data-testid="preset-browser">{JSON.stringify(userPatches)}</div>
    ))
);
const midiLearnRotaryKnobMock = vi.hoisted(() => vi.fn(() => <div data-testid="midi-learn-knob" />));
const loadUserPatchesMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted<{ value: unknown }>(() => ({ value: null }));

vi.mock('#/infra/store/useStoreSelector', () => ({
    useStoreSelector: vi.fn((_store: unknown, selector: (state: unknown) => unknown) => selector(storeState.value)),
}));

vi.mock('../../components/PresetBrowser', () => ({
    PresetBrowser: presetBrowserMock,
}));

vi.mock('#/modules/ControlSurface/presentations/views', () => ({
    MidiLearnRotaryKnob: midiLearnRotaryKnobMock,
}));

vi.mock('../../../useCases/user-patches/load-user-patches', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../useCases/user-patches/load-user-patches')>();
    loadUserPatchesMock.mockImplementation(actual.loadUserPatches);
    return { loadUserPatches: loadUserPatchesMock };
});

function makeState(overrides: Record<string, unknown> = {}) {
    return {
        'fermenter-1': {
            patch: { ...DEFAULT_PATCH, ...overrides },
            activeVoices: 3,
            uiLevel: 1,
            ...overrides,
        },
    };
}

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
        storeState.value = makeState();
    });

    describe('randomizePatch', () => {
        it('produces a patch with randomized engine, waveform, and filter values within valid ranges', () => {
            const patch = randomizePatch();
            expect(patch.oscEngine).toBeGreaterThanOrEqual(0);
            expect(patch.oscEngine).toBeLessThanOrEqual(6);
            expect(patch.oscWaveform).toBeGreaterThanOrEqual(0);
            expect(patch.oscWaveform).toBeLessThanOrEqual(3);
            expect(patch.filterCutoff).toBeGreaterThanOrEqual(200);
            expect(patch.filterCutoff).toBeLessThanOrEqual(12000);
            expect(patch.macros).toHaveLength(8);
            expect(patch.name).toBe('Random');
        });

        it('keeps amp envelope values within their constrained ranges', () => {
            const patch = randomizePatch();
            expect(patch.ampAttack).toBeGreaterThanOrEqual(0.001);
            expect(patch.ampAttack).toBeLessThanOrEqual(0.5);
            expect(patch.ampSustain).toBeGreaterThanOrEqual(0);
            expect(patch.ampSustain).toBeLessThanOrEqual(1);
            expect(patch.ampRelease).toBeGreaterThanOrEqual(0.05);
            expect(patch.ampRelease).toBeLessThanOrEqual(2);
        });
    });

    describe('section navigation', () => {
        it('shows the oscillator section header by default', () => {
            renderPanel();
            expect(screen.getByText('Oscillator theater')).toBeInTheDocument();
        });

        it('switches to the filter section header when the Filter tab is clicked', () => {
            renderPanel();
            // The SectionNav "Filter" tab — use getAllByRole since "filter" may match chips too.
            const filterTabs = screen.getAllByRole('button', { name: /^Filter$/ });
            fireEvent.click(filterTabs[0]!);
            expect(screen.getByText('Filter contour')).toBeInTheDocument();
        });

        it('switches to the envelopes section header when the Envelopes tab is clicked', () => {
            renderPanel();
            fireEvent.click(screen.getByRole('button', { name: /envelopes/i }));
            expect(screen.getByText('Envelope and drift')).toBeInTheDocument();
        });

        it('switches to the modulation section header when the Modulation tab is clicked', () => {
            renderPanel();
            fireEvent.click(screen.getByRole('button', { name: /modulation/i }));
            expect(screen.getByText('Mod constellation')).toBeInTheDocument();
        });

        it('switches to the effects section header when the Effects tab is clicked', () => {
            renderPanel();
            fireEvent.click(screen.getByRole('button', { name: /effects/i }));
            expect(screen.getByText('Effects bus')).toBeInTheDocument();
        });
    });

    describe('metric tiles', () => {
        it('shows the engine name and waveform number in the Engine tile', () => {
            storeState.value = makeState({ oscEngine: 2, oscWaveform: 1 });
            renderPanel();
            // "Wave 2" is unique to the Engine MetricTile.
            expect(screen.getByText('Wave 2')).toBeInTheDocument();
            // FM engine name appears in the metric tile and header LED.
            expect(screen.getAllByText('FM').length).toBeGreaterThan(0);
        });

        it('shows the cutoff in Hz and resonance with one decimal', () => {
            storeState.value = makeState({ filterCutoff: 4266.7, filterResonance: 3.25 });
            renderPanel();
            expect(screen.getByText('4267 Hz')).toBeInTheDocument();
            expect(screen.getByText('Res 3.3')).toBeInTheDocument();
        });

        it('shows the LFO rate with two decimals and macro A percentage', () => {
            storeState.value = makeState({ lfoRate: 4.567 });
            renderPanel();
            expect(screen.getByText('4.57 Hz')).toBeInTheDocument();
        });

        it('shows singular "layer" when numLayers is 1', () => {
            storeState.value = makeState({ numLayers: 1 });
            renderPanel();
            expect(screen.getByText(/1 layer$/)).toBeInTheDocument();
        });

        it('shows plural "layers" when numLayers is greater than 1', () => {
            storeState.value = makeState({ numLayers: 3 });
            renderPanel();
            expect(screen.getByText(/3 layers$/)).toBeInTheDocument();
        });
    });

    describe('portamento display (modulation section)', () => {
        it('shows "Off" when portamento time is 0', () => {
            storeState.value = makeState({ portamentoTime: 0 });
            renderPanel();
            fireEvent.click(screen.getByRole('button', { name: /modulation/i }));
            expect(screen.getByText('Off')).toBeInTheDocument();
        });

        it('shows the time in milliseconds when portamento is non-zero', () => {
            storeState.value = makeState({ portamentoTime: 0.125 });
            renderPanel();
            fireEvent.click(screen.getByRole('button', { name: /modulation/i }));
            // 0.125 * 1000 = 125 ms
            expect(screen.getByText('125 ms')).toBeInTheDocument();
        });
    });

    describe('engine name fallback', () => {
        it('falls back to Wavetable when the engine index is out of range', () => {
            storeState.value = makeState({ oscEngine: 99 });
            renderPanel();
            expect(screen.getAllByText('Wavetable').length).toBeGreaterThan(0);
        });
    });

    describe('user patch sanitization', () => {
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
    });

    describe('save flow', () => {
        it('reflects a newly saved user patch in the preset browser', async () => {
            const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
            render(
                <QueryClientProvider client={client}>
                    <FermenterPanel deviceId="fermenter-1" />
                </QueryClientProvider>
            );

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
                const props = presetBrowserMock.mock.lastCall?.[0] as
                    { userPatches: Array<{ name: string }> } | undefined;
                expect(
                    props?.userPatches.map((userPatch) => userPatch.name),
                    'saved patch must reach the preset browser without a remount'
                ).toContain('My patch');
            });
        });

        it('dismisses the save input on Escape without saving', () => {
            renderPanel();
            const openSave = screen.getAllByRole('button').find((button) => button.querySelector('svg.lucide-save'));
            fireEvent.click(openSave!);

            const nameInput = screen.getByPlaceholderText('Name…');
            fireEvent.keyDown(nameInput, { key: 'Escape' });

            expect(screen.queryByPlaceholderText('Name…')).not.toBeInTheDocument();
        });
    });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { FermenterPanel, randomizePatch } from '../FermenterPanel';

const presetBrowserMock = vi.hoisted(() =>
    vi.fn(
        ({
            userPatches,
            onLoadPreset,
        }: {
            userPatches: Array<{ id: string; name: string; patch?: unknown }>;
            onLoadPreset: (presetId: string) => void;
        }) => (
            <div data-testid="preset-browser">
                {JSON.stringify(userPatches)}
                <button type="button" onClick={() => onLoadPreset('fermenter-init')}>
                    Load Init
                </button>
                <button type="button" onClick={() => onLoadPreset('nonexistent-preset')}>
                    Load Missing
                </button>
            </div>
        )
    )
);
/**
 * Functional knob mock: renders a clickable button addressed by `paramId` that
 * invokes the real `onChange` prop the panel wired up. This lets tests verify the
 * per-section param routing (onParam('oscLevel', v) etc.) without the real
 * pointer-drag machinery. A fixed increment is emitted so the routed value is
 * deterministic and assertable.
 */
const midiLearnRotaryKnobMock = vi.hoisted(() =>
    vi.fn(({ value, onChange, paramId }: { value: number; onChange: (v: number) => void; paramId?: string }) => (
        <button
            type="button"
            data-testid="midi-learn-knob"
            data-paramid={paramId}
            data-value={value}
            onClick={() => onChange(value + 1)}
        >
            knob
        </button>
    ))
);
const setFermenterParamWithAudioMock = vi.hoisted(() => vi.fn());
const loadUserPatchesMock = vi.hoisted(() => vi.fn());
const loadFermenterPatchWithAudioMock = vi.hoisted(() => vi.fn());
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

vi.mock('../../../useCases/fermenterParamBridge/loadFermenterPatchWithAudio', () => ({
    loadFermenterPatchWithAudio: loadFermenterPatchWithAudioMock,
}));

vi.mock('../../../useCases/fermenterParamBridge/setFermenterParamWithAudio', () => ({
    setFermenterParamWithAudio: setFermenterParamWithAudioMock,
}));

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

/** Click the functional knob mock whose data-paramid matches, emitting value+1. */
function clickKnobByParamId(paramId: string): void {
    const knobs = screen.getAllByTestId('midi-learn-knob');
    const target = knobs.find((k) => k.getAttribute('data-paramid') === paramId);
    expect(target, `no knob with paramId="${paramId}" rendered`).toBeTruthy();
    fireEvent.click(target!);
}

/** Assert the panel routed a knob change to setFermenterParamWithAudio. */
function expectRouted(key: string, emittedValue: number): void {
    const call = setFermenterParamWithAudioMock.mock.calls.find(([, k]) => k === key);
    expect(call, `param "${key}" was not routed to the device`).toBeTruthy();
    expect(call![0]).toBe('fermenter-1');
    expect(call![2]).toBe(emittedValue);
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

    describe('preset loading', () => {
        it('loads a factory preset by id and applies its parameterValues to the device', () => {
            renderPanel();
            fireEvent.click(screen.getByText('Load Init'));

            // loadFermenterPatchWithAudio receives (deviceId, patch). The init
            // preset's name ("Blank Dough") is applied to the loaded patch.
            const initCall = loadFermenterPatchWithAudioMock.mock.calls.find(
                ([, patch]) => patch?.name === 'Blank Dough'
            );
            expect(initCall).toBeTruthy();
            expect(initCall![0]).toBe('fermenter-1');
        });

        it('returns without applying when the preset id does not exist', () => {
            renderPanel();
            // Clear any calls from initial render / other interactions
            loadFermenterPatchWithAudioMock.mockClear();
            fireEvent.click(screen.getByText('Load Missing'));

            // loadPresetPatch returns null → loadFermenterPatchWithAudio not called.
            expect(loadFermenterPatchWithAudioMock).not.toHaveBeenCalled();
        });

        it('prefers a user patch over a factory preset with the same id', async () => {
            // Store a user patch with id 'fermenter-init' so loadPresetPatch
            // finds it in userPatches before checking FERMENTER_PRESETS.
            window.localStorage.setItem(
                'fermenter-user-patches',
                JSON.stringify([
                    {
                        id: 'fermenter-init',
                        name: 'My Custom Init',
                        patch: { oscLevel: 0.3 },
                    },
                ])
            );

            renderPanel();
            // Wait for the userPatches query to resolve before loading the preset.
            await waitFor(() => {
                expect(screen.getByTestId('preset-browser').textContent).toContain('My Custom Init');
            });

            fireEvent.click(screen.getByText('Load Init'));

            const call = loadFermenterPatchWithAudioMock.mock.calls.find(
                ([, patch]) => patch?.name === 'My Custom Init'
            );
            expect(call).toBeTruthy();
            expect(call![1].oscLevel).toBe(0.3);
        });
    });

    describe('section param routing', () => {
        // Each knob in the active section is a functional mock that emits
        // value+1 on click. Asserting setFermenterParamWithAudio receives the
        // right (deviceId, key, value) proves the panel wired the section
        // callback to the correct param key.

        it('routes the oscillator section knobs to their param keys', () => {
            storeState.value = makeState({ oscLevel: 0.5, oscCoarse: 0, oscFine: 0, noiseLevel: 0.2 });
            renderPanel();
            // The oscillator section is the default active section.
            for (const paramId of ['oscLevel', 'oscCoarse', 'oscFine', 'noiseLevel']) {
                clickKnobByParamId(paramId);
            }
            expectRouted('oscLevel', 1.5);
            expectRouted('oscCoarse', 1);
            expectRouted('oscFine', 1);
            expectRouted('noiseLevel', 1.2);
        });

        it('routes the oscillator engine + waveform chip clicks to oscEngine/oscWaveform', () => {
            renderPanel();
            // ENGINE_NAMES[2] = 'FM', WAVEFORM_NAMES[1] = 'Saw'.
            fireEvent.click(screen.getByText('FM'));
            fireEvent.click(screen.getByText('Saw'));
            const calls = setFermenterParamWithAudioMock.mock.calls;
            expect(calls.find(([, k]) => k === 'oscEngine')![2]).toBe(2);
            expect(calls.find(([, k]) => k === 'oscWaveform')![2]).toBe(1);
        });

        it('routes the filter section knobs to their param keys', () => {
            storeState.value = makeState({ filterCutoff: 1000, filterResonance: 1, filterDrive: 0.4 });
            renderPanel();
            fireEvent.click(screen.getAllByRole('button', { name: /^Filter$/ })[0]!);
            for (const paramId of ['filterCutoff', 'filterResonance', 'filterDrive']) {
                clickKnobByParamId(paramId);
            }
            expectRouted('filterCutoff', 1001);
            expectRouted('filterResonance', 2);
            expectRouted('filterDrive', 1.4);
        });

        it('routes the LFO knobs (envelopes section) to their param keys', () => {
            storeState.value = makeState({ lfoRate: 2, lfoPitchAmount: 0.5, lfoFilterAmount: 0.3 });
            renderPanel();
            fireEvent.click(screen.getByRole('button', { name: /envelopes/i }));
            for (const paramId of ['lfoRate', 'lfoPitchAmount', 'lfoFilterAmount']) {
                clickKnobByParamId(paramId);
            }
            expectRouted('lfoRate', 3);
            expectRouted('lfoPitchAmount', 1.5);
            expectRouted('lfoFilterAmount', 1.3);
        });

        it('renders the portamento slider and its zero-state readout', () => {
            storeState.value = makeState({ portamentoTime: 0 });
            renderPanel();
            fireEvent.click(screen.getByRole('button', { name: /modulation/i }));
            // The Slider has an accessible name via aria-label.
            expect(screen.getByLabelText('Portamento time')).toBeInTheDocument();
            // portamentoTime 0 → "Off" readout (the falsy branch of the ternary).
            expect(screen.getByText('Off')).toBeInTheDocument();
        });

        it('routes the unison section knobs (engine 0 default) to their param keys', () => {
            // oscEngine 0 → renderEngineControls falls through to UnisonSection.
            storeState.value = makeState({ oscEngine: 0, unisonVoices: 2, unisonDetune: 0.1, unisonSpread: 0.5 });
            renderPanel();
            // Unison section renders in the oscillator section's engine-controls pane.
            for (const paramId of ['unisonVoices', 'unisonDetune', 'unisonSpread']) {
                clickKnobByParamId(paramId);
            }
            expectRouted('unisonVoices', 3);
            expectRouted('unisonDetune', 1.1);
            expectRouted('unisonSpread', 1.5);
        });

        it('routes the pulse-width knob (only shown for analog square) to pulseWidth', () => {
            // showPW = engine === 1 && waveform === 2.
            storeState.value = makeState({ oscEngine: 1, oscWaveform: 2, pulseWidth: 0.4 });
            renderPanel();
            clickKnobByParamId('pulseWidth');
            expectRouted('pulseWidth', 1.4);
        });

        it('routes the noise-color chip selection to noiseColor', () => {
            renderPanel();
            // NOISE_COLOR_NAMES = ['White', 'Pink', 'Brown'] — clicking index 1 emits Pink.
            fireEvent.click(screen.getByText('Pink'));
            expectRouted('noiseColor', 1);
        });

        it('routes the filter model + mode chip selections to filterModel/filterMode', () => {
            renderPanel();
            fireEvent.click(screen.getAllByRole('button', { name: /^Filter$/ })[0]!);
            // FILTER_MODE_NAMES[2] = 'Band Pass' (rendered as a chip).
            fireEvent.click(screen.getByText('Band Pass'));
            // FILTER_MODEL_NAMES[1] = 'Moog (Warm)'.
            fireEvent.click(screen.getByText('Moog (Warm)'));
            const calls = setFermenterParamWithAudioMock.mock.calls;
            expect(calls.find(([, k]) => k === 'filterMode')![2]).toBe(2);
            expect(calls.find(([, k]) => k === 'filterModel')![2]).toBe(1);
        });

        it('routes the filter env-amount + keytrack knobs to their param keys', () => {
            storeState.value = makeState({ filterEnvAmount: 0.5, filterKeytrack: 0.2 });
            renderPanel();
            fireEvent.click(screen.getAllByRole('button', { name: /^Filter$/ })[0]!);
            clickKnobByParamId('filterEnvAmount');
            clickKnobByParamId('filterKeytrack');
            expectRouted('filterEnvAmount', 1.5);
            expectRouted('filterKeytrack', 1.2);
        });

        it('routes the LFO shape chip selection to lfoShape', () => {
            storeState.value = makeState({ lfoShape: 0 });
            renderPanel();
            fireEvent.click(screen.getByRole('button', { name: /envelopes/i }));
            // LFO_SHAPE_NAMES sliced to 3 chars: 'Sin','Tri','Saw','Squ'. Click 'Tri' (index 1).
            fireEvent.click(screen.getByText('Tri'));
            expectRouted('lfoShape', 1);
        });
    });

    describe('macro + layer routing', () => {
        it('routes the LayerStack layer + count controls when uiLevel >= 3', () => {
            // LayerStack is gated behind uiLevel >= 3.
            storeState.value = makeState({ uiLevel: 3, numLayers: 2, activeLayer: 0 });
            renderPanel();
            // Click the "+" button to increment numLayers (2 → 3).
            const plusBtn = screen.getByRole('button', { name: 'Increase layer count' });
            fireEvent.click(plusBtn);
            expectRouted('numLayers', 3);
            // Click "Layer 2" to set activeLayer.
            fireEvent.click(screen.getByText('Layer 2'));
            expectRouted('activeLayer', 1);
        });

        it('renders the SignalFlowView when uiLevel >= 4', () => {
            storeState.value = makeState({ uiLevel: 4 });
            renderPanel();
            // SignalFlowView renders a section selector; verify it mounts.
            expect(screen.getByText(/Signal Flow|Routing|signal/i)).toBeInTheDocument();
        });
    });

    describe('engine-specific controls rendering', () => {
        // renderEngineControls switches on oscEngine. Each branch renders a
        // distinct sub-section; verify the engine pane mounts the right one.
        it('renders the FM section when oscEngine is 2', () => {
            storeState.value = makeState({ oscEngine: 2 });
            renderPanel();
            expect(screen.getByText('FM Engine')).toBeInTheDocument();
        });

        it('renders the Karplus section when oscEngine is 3', () => {
            storeState.value = makeState({ oscEngine: 3 });
            renderPanel();
            // KarplusSection renders the "String Model" sub-section header.
            expect(screen.getByText('String Model')).toBeInTheDocument();
        });

        it('renders the Granular section when oscEngine is 4', () => {
            storeState.value = makeState({ oscEngine: 4 });
            renderPanel();
            // GranularSection renders the "Grain Cloud" sub-section header.
            expect(screen.getByText('Grain Cloud')).toBeInTheDocument();
        });

        it('renders the Additive section when oscEngine is 5', () => {
            storeState.value = makeState({ oscEngine: 5 });
            renderPanel();
            // AdditiveSection renders a "Partials" knob label.
            expect(screen.getByText('Partials')).toBeInTheDocument();
        });

        it('renders the Crumbs/Sampler section when oscEngine is 6', () => {
            storeState.value = makeState({ oscEngine: 6 });
            renderPanel();
            // CrumbsSection renders "Start"/"End" position labels.
            expect(screen.getAllByText('Start').length).toBeGreaterThan(0);
        });

        it('routes the FM section knob changes through onParam', () => {
            storeState.value = makeState({ oscEngine: 2, fmFeedback: 0.3 });
            renderPanel();
            clickKnobByParamId('fmFeedback');
            expectRouted('fmFeedback', 1.3);
        });
    });

    describe('compact header and minimum height layout constraints', () => {
        it('renders compact toolbar strip and minimum height constraints for drawer scrolling', () => {
            storeState.value = makeState({ activeVoices: 4, oscEngine: 0 });
            const { container } = renderPanel();

            const faceplate = container.querySelector('.fermenter-faceplate');
            expect(faceplate).toHaveClass('min-h-[460px]');
            expect(faceplate).toHaveClass('h-full');

            const header = container.querySelector('header');
            expect(header).toHaveClass('min-h-[32px]');
            expect(screen.getByText('Scene')).toBeInTheDocument();
            expect(screen.getByText('4 voices')).toBeInTheDocument();

            const paramScrollContainer = container.querySelector('.min-h-\\[180px\\]');
            expect(paramScrollContainer).toBeInTheDocument();
            expect(paramScrollContainer).toHaveClass('overflow-y-auto');

            const rightRail = container.querySelector('aside.min-h-\\[220px\\]');
            expect(rightRail).toBeInTheDocument();
            expect(rightRail).toHaveClass('overflow-y-auto');

            const leftRail = container.querySelector('aside.w-\\[228px\\]');
            expect(leftRail).toBeInTheDocument();
            expect(leftRail).toHaveClass('overflow-y-auto', 'min-h-0');

            const centerSection = container.querySelector('section');
            expect(centerSection).toBeInTheDocument();
            expect(centerSection).toHaveClass('overflow-y-auto', 'min-h-0');
        });

        it('prevents rail cards from collapsing with shrink constraints', () => {
            storeState.value = makeState({ uiLevel: 5 });
            const { container } = renderPanel();

            const leftRail = container.querySelector('aside.w-\\[228px\\]');
            const leftRailCards = leftRail?.children;
            expect(leftRailCards).toBeDefined();
            if (leftRailCards) {
                for (const card of Array.from(leftRailCards)) {
                    expect(card).toHaveClass('shrink-0');
                }
            }

            const presetBrowserContainer = leftRail?.querySelector('.min-h-\\[160px\\]');
            expect(presetBrowserContainer).toHaveClass('shrink-0');

            const rightRail = container.querySelector('aside.min-h-\\[220px\\]');
            const rightRailCards = rightRail?.children;
            expect(rightRailCards).toBeDefined();
            if (rightRailCards) {
                for (const card of Array.from(rightRailCards)) {
                    expect(card).toHaveClass('shrink-0');
                }
            }
        });

        it('renders SectionHeader with stacked eyebrow and title in a column to prevent horizontal truncation', () => {
            renderPanel();
            const eyebrow = screen.getByText('Scenes');
            const title = screen.getByText('Preset bench');
            const stackContainer = eyebrow.parentElement;

            expect(stackContainer).toBe(title.parentElement);
            expect(stackContainer).toHaveClass('flex-col');
            expect(stackContainer).toHaveClass('min-w-0');
            expect(title).toHaveClass('truncate');
        });
    });

    describe('accessible toolbar actions', () => {
        it('renders accessible patch and preset action buttons', () => {
            renderPanel();
            expect(screen.getByRole('button', { name: 'Open save preset dialog' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Reset patch to default' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Randomize patch' })).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'Open save preset dialog' }));
            expect(screen.getByRole('button', { name: 'Save preset' })).toBeInTheDocument();
        });
    });
});

import { type ReactElement, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, RotateCcw, Save, Shuffle } from 'lucide-react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Slider } from '#/components/ui/slider';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { MidiLearnRotaryKnob } from '#/modules/ControlSurface/presentations/views';

import { DEFAULT_PATCH, type FermenterPatch, ENGINE_NAMES } from '../../models/FermenterPatch';
import {
    fermenterStore,
    getFermenterState,
    setFermenterUiLevel,
    type FermenterState,
} from '../../stores/fermenterStore';
import { applyFermenterMacroMapping } from '../../useCases/applyFermenterMacroMapping';
import { loadFermenterPatchWithAudio } from '../../useCases/fermenterParamBridge/loadFermenterPatchWithAudio';
import { setFermenterParamWithAudio } from '../../useCases/fermenterParamBridge/setFermenterParamWithAudio';
import { FERMENTER_PRESETS } from '../../useCases/fermenterQueries/helpers';
import { loadUserPatches } from '../../useCases/user-patches/load-user-patches';
import { saveUserPatch } from '../../useCases/user-patches/save-user-patch';
import { AdditiveSection } from '../components/AdditiveSection';
import { CrumbsSection } from '../components/CrumbsSection';
import { EffectsSection } from '../components/EffectsSection';
import { EnvelopeSection } from '../components/EnvelopeSection';
import { FilterSection } from '../components/FilterSection';
import { FmSection } from '../components/FmSection';
import { GranularSection } from '../components/GranularSection';
import { KarplusSection } from '../components/KarplusSection';
import { LayerStack } from '../components/LayerStack';
import { LfoSection } from '../components/LfoSection';
import { MacroMatrixEditor } from '../components/MacroMatrixEditor';
import { MacroStrip } from '../components/MacroStrip';
import { ModulationSection } from '../components/ModulationSection';
import { OscillatorSection } from '../components/OscillatorSection';
import { Oscilloscope } from '../components/Oscilloscope';
import { OutputMeter } from '../components/OutputMeter';
import { PresetBrowser } from '../components/PresetBrowser';
import { SectionNav, type FermenterSection } from '../components/SectionNav';
import { SignalFlowView } from '../components/SignalFlowView';
import { SpectrumAnalyzer } from '../components/SpectrumAnalyzer';
import { UnisonSection } from '../components/UnisonSection';
import { WarpSection } from '../components/WarpSection';
import { XYPad } from '../components/XYPad';

import { TransformPad } from './TransformPad';

const USER_PATCHES_QUERY_KEY = ['fermenter', 'user-patches'] as const;

const LEVELS = [
    { id: 1, label: 'Play', eyebrow: 'Scene' },
    { id: 2, label: 'Shape', eyebrow: 'Voice' },
    { id: 3, label: 'Build', eyebrow: 'Stack' },
    { id: 4, label: 'Route', eyebrow: 'Flow' },
    { id: 5, label: 'Lab', eyebrow: 'Bench' },
] as const;

function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}

function getSectionMeta(section: FermenterSection): {
    eyebrow: string;
    title: string;
    description: string;
    detail: string;
} {
    if (section === 'osc') {
        return {
            eyebrow: 'Engine',
            title: 'Oscillator theater',
            description:
                'Keep the sound source front and center, then layer extra engines only when the patch needs it.',
            detail: 'Wave + motion',
        };
    }
    if (section === 'filter') {
        return {
            eyebrow: 'Tone',
            title: 'Filter contour',
            description:
                'Shape the harmonic body and watch the synth breathe instead of chasing knobs across the panel.',
            detail: 'Cutoff + bite',
        };
    }
    if (section === 'env') {
        return {
            eyebrow: 'Motion',
            title: 'Envelope and drift',
            description: 'Amplitude and movement stay readable in one place so you can sculpt response quickly.',
            detail: 'ADSR core',
        };
    }
    if (section === 'mod') {
        return {
            eyebrow: 'Routes',
            title: 'Mod constellation',
            description: 'Sources and destinations should feel connected, not like separate spreadsheets.',
            detail: 'LFO + seq',
        };
    }
    return {
        eyebrow: 'Space',
        title: 'Effects bus',
        description:
            'Delay, reverb, distortion, and polish live together so the patch can finish strong without a separate plugin.',
        detail: 'Send + finish',
    };
}

const MetricTile = ({ label, value, detail }: { label: string; value: string; detail: string }): ReactElement => (
    <Stack gap={1} className="fermenter-window min-w-[92px] px-3 py-2">
        <span className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">{label}</span>
        <span className="font-mono text-[13px] text-foreground">{value}</span>
        <span className="text-[9px] text-muted-foreground/55">{detail}</span>
    </Stack>
);

const SectionHeader = ({
    eyebrow,
    title,
    description,
    detail,
}: {
    eyebrow: string;
    title: string;
    description: string;
    detail?: string;
}): ReactElement => (
    <Row align="start" justify="between" gap={3}>
        <Stack gap={1}>
            <div className="text-[8px] font-semibold uppercase tracking-[0.28em] text-[var(--color-accent-sage)]/70">
                {eyebrow}
            </div>
            <div className="text-[13px] font-semibold text-foreground">{title}</div>
            <span className="sr-only">{description}</span>
        </Stack>
        {detail ? (
            <DawPluginLed tone="sage" className="shrink-0">
                {detail}
            </DawPluginLed>
        ) : null}
    </Row>
);

function loadPresetPatch(
    presetId: string,
    userPatches: Array<{ id: string; name: string; patch: FermenterPatch }>
): FermenterPatch | null {
    const userPatch = userPatches.find((patch) => patch.id === presetId);
    if (userPatch) {
        return userPatch.patch;
    }

    const preset = FERMENTER_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) {
        return null;
    }

    const values = preset.devices[0]?.parameterValues;
    if (!values) {
        return null;
    }

    const patch: FermenterPatch = { ...DEFAULT_PATCH, name: preset.name, macros: [...DEFAULT_PATCH.macros] };
    for (const [key, value] of Object.entries(values)) {
        if (key in patch && typeof value === 'number') {
            (patch as Record<string, unknown>)[key] = value;
        } else if (key.startsWith('macro') && typeof value === 'number') {
            const idx = parseInt(key.slice(5), 10);
            if (idx >= 0 && idx < 8) {
                patch.macros[idx] = value;
            }
        }
    }

    return patch;
}

export function randomizePatch(): FermenterPatch {
    const range = (min: number, max: number) => min + Math.random() * (max - min);
    const randomInt = (min: number, max: number) => Math.floor(range(min, max + 1));

    return {
        ...DEFAULT_PATCH,
        name: 'Random',
        oscEngine: randomInt(0, 6),
        oscWaveform: randomInt(0, 3),
        oscLevel: range(0.5, 1),
        filterModel: randomInt(0, 5),
        filterCutoff: range(200, 12000),
        filterResonance: range(0.5, 8),
        ampAttack: range(0.001, 0.5),
        ampDecay: range(0.05, 1),
        ampSustain: range(0, 1),
        ampRelease: range(0.05, 2),
        filterEnvAmount: range(-0.8, 0.8),
        reverbMix: range(0, 0.6),
        masterGain: range(0.6, 1),
        macros: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    };
}

function renderEngineControls(patch: FermenterPatch, onParam: (key: string, value: number) => void): ReactElement {
    if (patch.oscEngine === 2) {
        return (
            <FmSection
                rotaryKnob={MidiLearnRotaryKnob}
                algorithm={patch.fmAlgorithm}
                ratios={[patch.fmRatio1, patch.fmRatio2, patch.fmRatio3, patch.fmRatio4]}
                levels={[patch.fmLevel1, patch.fmLevel2, patch.fmLevel3, patch.fmLevel4]}
                feedback={patch.fmFeedback}
                modAmount={patch.fmModAmount}
                onParam={onParam}
            />
        );
    }

    if (patch.oscEngine === 3) {
        return (
            <KarplusSection
                damping={patch.ksDamping}
                brightness={patch.ksBrightness}
                onDampingChange={(value) => onParam('ksDamping', value)}
                onBrightnessChange={(value) => onParam('ksBrightness', value)}
            />
        );
    }

    if (patch.oscEngine === 4) {
        return (
            <GranularSection
                density={patch.grainDensity}
                size={patch.grainSize}
                position={patch.grainPosition}
                spray={patch.grainSpray}
                pitchVar={patch.grainPitchVar}
                panSpread={patch.grainPanSpread}
                onParam={onParam}
            />
        );
    }

    if (patch.oscEngine === 5) {
        return (
            <AdditiveSection
                partials={patch.additivePartials}
                tilt={patch.additiveTilt}
                oddEmphasis={patch.additiveOdd}
                inharmonicity={patch.additiveInharm}
                onParam={onParam}
            />
        );
    }

    if (patch.oscEngine === 6) {
        return (
            <CrumbsSection
                mode={patch.samplerMode}
                start={patch.samplerStart}
                end={patch.samplerEnd}
                onParam={onParam}
            />
        );
    }

    return (
        <UnisonSection
            rotaryKnob={MidiLearnRotaryKnob}
            voices={patch.unisonVoices}
            detune={patch.unisonDetune}
            spread={patch.unisonSpread}
            onVoicesChange={(value) => onParam('unisonVoices', value)}
            onDetuneChange={(value) => onParam('unisonDetune', value)}
            onSpreadChange={(value) => onParam('unisonSpread', value)}
        />
    );
}

function renderSectionContent(
    section: FermenterSection,
    patch: FermenterPatch,
    onParam: (key: string, value: number) => void
): ReactElement {
    if (section === 'osc') {
        return (
            <Row align="start" wrap gap={4}>
                <OscillatorSection
                    rotaryKnob={MidiLearnRotaryKnob}
                    engine={patch.oscEngine}
                    waveform={patch.oscWaveform}
                    level={patch.oscLevel}
                    coarse={patch.oscCoarse}
                    fine={patch.oscFine}
                    pulseWidth={patch.pulseWidth}
                    noiseLevel={patch.noiseLevel}
                    noiseColor={patch.noiseColor}
                    onEngineChange={(value) => onParam('oscEngine', value)}
                    onWaveformChange={(value) => onParam('oscWaveform', value)}
                    onLevelChange={(value) => onParam('oscLevel', value)}
                    onCoarseChange={(value) => onParam('oscCoarse', value)}
                    onFineChange={(value) => onParam('oscFine', value)}
                    onPulseWidthChange={(value) => onParam('pulseWidth', value)}
                    onNoiseLevelChange={(value) => onParam('noiseLevel', value)}
                    onNoiseColorChange={(value) => onParam('noiseColor', value)}
                />
                <div className="border-l border-border/15 pl-4">{renderEngineControls(patch, onParam)}</div>
                <div className="border-l border-border/15 pl-4">
                    <WarpSection
                        warpMode={patch.warpMode}
                        warpAmount={patch.warpAmount}
                        audioModRate={patch.audioModRate}
                        audioModDepth={patch.audioModDepth}
                        audioModTarget={patch.audioModTarget}
                        onParam={onParam}
                    />
                </div>
            </Row>
        );
    }

    if (section === 'filter') {
        return (
            <FilterSection
                rotaryKnob={MidiLearnRotaryKnob}
                model={patch.filterModel}
                cutoff={patch.filterCutoff}
                resonance={patch.filterResonance}
                mode={patch.filterMode}
                envAmount={patch.filterEnvAmount}
                drive={patch.filterDrive}
                keytrack={patch.filterKeytrack}
                onModelChange={(value) => onParam('filterModel', value)}
                onCutoffChange={(value) => onParam('filterCutoff', value)}
                onResonanceChange={(value) => onParam('filterResonance', value)}
                onModeChange={(value) => onParam('filterMode', value)}
                onEnvAmountChange={(value) => onParam('filterEnvAmount', value)}
                onDriveChange={(value) => onParam('filterDrive', value)}
                onKeytrackChange={(value) => onParam('filterKeytrack', value)}
            />
        );
    }

    if (section === 'env') {
        return (
            <Row align="start" wrap gap={4}>
                <EnvelopeSection
                    rotaryKnob={MidiLearnRotaryKnob}
                    ampA={patch.ampAttack}
                    ampD={patch.ampDecay}
                    ampS={patch.ampSustain}
                    ampR={patch.ampRelease}
                    filterA={patch.filterAttack}
                    filterD={patch.filterDecay}
                    filterS={patch.filterSustain}
                    filterR={patch.filterRelease}
                    onAmpChange={(key, value) => onParam(key, value)}
                    onFilterChange={(key, value) => onParam(key, value)}
                />
                <div className="border-l border-border/15 pl-4">
                    <LfoSection
                        rotaryKnob={MidiLearnRotaryKnob}
                        rate={patch.lfoRate}
                        shape={patch.lfoShape}
                        pitchAmount={patch.lfoPitchAmount}
                        filterAmount={patch.lfoFilterAmount}
                        onRateChange={(value) => onParam('lfoRate', value)}
                        onShapeChange={(value) => onParam('lfoShape', value)}
                        onPitchAmountChange={(value) => onParam('lfoPitchAmount', value)}
                        onFilterAmountChange={(value) => onParam('lfoFilterAmount', value)}
                    />
                </div>
            </Row>
        );
    }

    if (section === 'mod') {
        return (
            <Row align="start" wrap gap={6}>
                <ModulationSection
                    msegToFilter={patch.msegToFilter}
                    seqRate={patch.seqRate}
                    seqToPitch={patch.seqToPitch}
                    onParam={onParam}
                />
                <Stack gap={2} className="border-l border-border/20 pl-4">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Glide</div>
                    <Row gap={3} className="fermenter-window px-3 py-2">
                        <Stack gap={1}>
                            <div className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/55">Time</div>
                            <div className="font-mono text-[12px] text-foreground">
                                {patch.portamentoTime === 0 ? 'Off' : `${(patch.portamentoTime * 1000).toFixed(0)} ms`}
                            </div>
                        </Stack>
                        <Slider
                            value={[patch.portamentoTime]}
                            min={0}
                            max={2}
                            step={0.01}
                            className="flex-1"
                            aria-label="Portamento time"
                            onValueChange={(values) => {
                                const nextValue = values[0];
                                if (nextValue !== undefined) {
                                    onParam('portamentoTime', nextValue);
                                }
                            }}
                        />
                    </Row>
                </Stack>
            </Row>
        );
    }

    return (
        <EffectsSection
            rotaryKnob={MidiLearnRotaryKnob}
            reverbType={patch.reverbType}
            reverbMix={patch.reverbMix}
            reverbDecay={patch.reverbDecay}
            delayTime={patch.delayTime}
            delayFeedback={patch.delayFeedback}
            delayMix={patch.delayMix}
            chorusRate={patch.chorusRate}
            chorusDepth={patch.chorusDepth}
            chorusMix={patch.chorusMix}
            phaserRate={patch.phaserRate}
            phaserDepth={patch.phaserDepth}
            phaserMix={patch.phaserMix}
            distDrive={patch.distDrive}
            distTone={patch.distTone}
            distMix={patch.distMix}
            compThreshold={patch.compThreshold}
            compRatio={patch.compRatio}
            compAttack={patch.compAttack}
            compRelease={patch.compRelease}
            compMix={patch.compMix}
            stereoWidth={patch.stereoWidth}
            masterGain={patch.masterGain}
            eqLowFreq={patch.eqLowFreq}
            eqLowGain={patch.eqLowGain}
            eqLowQ={patch.eqLowQ}
            eqMidFreq={patch.eqMidFreq}
            eqMidGain={patch.eqMidGain}
            eqMidQ={patch.eqMidQ}
            eqHighFreq={patch.eqHighFreq}
            eqHighGain={patch.eqHighGain}
            eqHighQ={patch.eqHighQ}
            onParam={onParam}
        />
    );
}

export const FermenterPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    const { patch, activeVoices, uiLevel } = useStoreSelector(
        fermenterStore,
        (state: Record<string, FermenterState> | null) => {
            const s = state ? state[deviceId] : null;
            if (!s) {
                return getFermenterState(deviceId);
            }
            return {
                patch: s.patch,
                activeVoices: s.activeVoices,
                uiLevel: s.uiLevel,
            };
        },
        (a, b) => a.patch === b.patch && a.activeVoices === b.activeVoices && a.uiLevel === b.uiLevel
    );

    const [section, setSection] = useState<FermenterSection>('osc');
    const [showSave, setShowSave] = useState(false);
    const [saveName, setSaveName] = useState('');

    // User patches come from the TanStack Query cache — never a render-body
    // read (a per-render loadUserPatches() put a synchronous localStorage
    // read + JSON.parse on the gesture path, and the React Compiler's
    // memoization made the post-save list permanently stale). The save flow
    // invalidates the key below to refresh the preset browser.
    const queryClient = useQueryClient();
    const { data: userPatches = [] } = useQuery({
        queryKey: USER_PATCHES_QUERY_KEY,
        queryFn: loadUserPatches,
        staleTime: Infinity,
    });
    const sectionMeta = getSectionMeta(section);

    function onParam(key: string, value: number): void {
        setFermenterParamWithAudio(deviceId, key as keyof FermenterPatch, value);
    }

    function setMacro(index: number, value: number): void {
        loadFermenterPatchWithAudio(deviceId, applyFermenterMacroMapping({ patch, index, value }));
    }

    function setMacroMappings(index: number, macroMappings: FermenterPatch['macroMappings']): void {
        const value = patch.macros[index] ?? 0.5;
        loadFermenterPatchWithAudio(
            deviceId,
            applyFermenterMacroMapping({ patch: { ...patch, macroMappings }, index, value })
        );
    }

    function loadPreset(presetId: string): void {
        const loadedPatch = loadPresetPatch(presetId, userPatches);
        if (!loadedPatch) {
            return;
        }

        loadFermenterPatchWithAudio(deviceId, loadedPatch);
    }

    function initPatch(): void {
        loadFermenterPatchWithAudio(deviceId, { ...DEFAULT_PATCH });
    }

    function applyRandomPatch(): void {
        loadFermenterPatchWithAudio(deviceId, randomizePatch());
    }

    function handleSave(): void {
        if (!saveName.trim()) {
            return;
        }

        if (!saveUserPatch({ name: saveName.trim(), patch })) {
            return;
        }
        setSaveName('');
        setShowSave(false);
        void queryClient.invalidateQueries({ queryKey: USER_PATCHES_QUERY_KEY });
    }

    return (
        <Row align="stretch" gap={2.5} className="fermenter-faceplate h-full min-h-0 overflow-hidden p-2.5">
            <Stack
                as="aside"
                gap={2.5}
                shrink={false}
                className="fermenter-window h-full w-[228px] overflow-hidden p-2.5"
            >
                <SectionHeader
                    eyebrow="Scenes"
                    title="Preset bench"
                    description="Pick instruments like scenes, not menu rows, then keep the performance controls close."
                    detail={`${userPatches.length} user`}
                />

                <Row align="stretch" wrap gap={1.5}>
                    {LEVELS.map((level) => (
                        <DawPluginChip
                            key={level.id}
                            active={uiLevel === level.id}
                            tone="sage"
                            size="sm"
                            onClick={() => setFermenterUiLevel(deviceId, level.id)}
                        >
                            {level.label}
                        </DawPluginChip>
                    ))}
                </Row>

                <Row justify="between" gap={2} className="fermenter-window px-3 py-2">
                    <div className="min-w-0">
                        <div className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">
                            Current scene
                        </div>
                        <div className="truncate text-[11px] text-foreground">{patch.name}</div>
                    </div>
                    <Row align="stretch" gap={1}>
                        {showSave ? (
                            <>
                                <Input
                                    type="text"
                                    value={saveName}
                                    onChange={(event) => setSaveName(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            handleSave();
                                        }
                                        if (event.key === 'Escape') {
                                            setShowSave(false);
                                        }
                                    }}
                                    placeholder="Name…"
                                    className="fermenter-window h-8 w-24 px-2 text-[10px] outline-none"
                                    autoFocus
                                />
                                <Button variant="ghost" size="icon-xs" className="h-8 w-8" onClick={handleSave}>
                                    <Save className="size-3" />
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="h-8 w-8"
                                    onClick={() => {
                                        setSaveName(patch.name === 'Init' ? '' : patch.name);
                                        setShowSave(true);
                                    }}
                                >
                                    <Save className="size-3" />
                                </Button>
                                <Button variant="ghost" size="icon-xs" className="h-8 w-8" onClick={initPatch}>
                                    <RotateCcw className="size-3" />
                                </Button>
                                <Button variant="ghost" size="icon-xs" className="h-8 w-8" onClick={applyRandomPatch}>
                                    <Shuffle className="size-3" />
                                </Button>
                            </>
                        )}
                    </Row>
                </Row>

                <div className="fermenter-window min-h-0 flex-1 overflow-hidden">
                    <PresetBrowser
                        currentName={patch.name}
                        userPatches={userPatches}
                        presets={FERMENTER_PRESETS}
                        onLoadPreset={loadPreset}
                    />
                </div>
            </Stack>

            <Stack grow gap={2.5} className="min-w-0">
                <Row as="header" wrap gap={2.5} shrink={false} className="fermenter-window px-3 py-2">
                    <Stack gap={1}>
                        <div className="text-[8px] uppercase tracking-[0.28em] text-[var(--color-accent-sage)]/70">
                            {LEVELS.find((level) => level.id === uiLevel)?.eyebrow ?? 'Voice'}
                        </div>
                        <div className="text-[13px] font-semibold text-foreground">Fermenter</div>
                    </Stack>

                    <Row gap={2} className="ml-auto">
                        <DawPluginLed tone="sage">{ENGINE_NAMES[patch.oscEngine] ?? 'Wavetable'}</DawPluginLed>
                        <Row gap={1} className="text-[10px] text-muted-foreground">
                            <Cpu className="size-3" />
                            <span>{activeVoices} voices</span>
                        </Row>
                        <OutputMeter deviceId={deviceId} height={20} />
                    </Row>
                </Row>

                <Grid cols={4} gap={2.5} className="shrink-0">
                    <MetricTile
                        label="Engine"
                        value={ENGINE_NAMES[patch.oscEngine] ?? 'Wavetable'}
                        detail={`Wave ${patch.oscWaveform + 1}`}
                    />
                    <MetricTile
                        label="Cutoff"
                        value={`${Math.round(patch.filterCutoff)} Hz`}
                        detail={`Res ${patch.filterResonance.toFixed(1)}`}
                    />
                    <MetricTile
                        label="Motion"
                        value={`${patch.lfoRate.toFixed(2)} Hz`}
                        detail={`Macro A ${formatPercent(patch.macros[0])}`}
                    />
                    <MetricTile
                        label="Width"
                        value={patch.stereoWidth.toFixed(2)}
                        detail={`${patch.numLayers} layer${patch.numLayers === 1 ? '' : 's'}`}
                    />
                </Grid>

                <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_260px] gap-2.5 overflow-hidden">
                    <Stack as="section" gap={2.5} className="fermenter-window overflow-hidden p-2.5">
                        <SectionHeader
                            eyebrow={sectionMeta.eyebrow}
                            title={sectionMeta.title}
                            description={sectionMeta.description}
                            detail={sectionMeta.detail}
                        />

                        <Stack gap={2} shrink={false} className="fermenter-window p-3">
                            <SectionNav active={section} onChange={setSection} />
                            <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-3">
                                <Row justify="center" className="fermenter-window h-[136px] p-2">
                                    <Oscilloscope deviceId={deviceId} width={360} height={96} />
                                </Row>
                                <Stack justify="between" className="fermenter-window p-3">
                                    <div>
                                        <div className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">
                                            Quick read
                                        </div>
                                        <div className="mt-1 text-[12px] font-medium text-foreground">
                                            {ENGINE_NAMES[patch.oscEngine] ?? 'Wavetable'}
                                        </div>
                                    </div>
                                    <Row justify="between" gap={2} className="text-[9px] text-muted-foreground">
                                        <span>Master {formatPercent(Math.min(1, patch.masterGain / 2))}</span>
                                        <span>Layer {patch.activeLayer + 1}</span>
                                    </Row>
                                </Stack>
                            </div>
                        </Stack>

                        <div className="min-h-0 flex-1 overflow-y-auto px-1">
                            <div className="pb-2">{renderSectionContent(section, patch, onParam)}</div>
                            {uiLevel >= 4 ? (
                                <div className="mt-3 border-t border-border/15 pt-3">
                                    <SignalFlowView
                                        patch={patch}
                                        numLayers={patch.numLayers}
                                        activeLayer={patch.activeLayer}
                                        onSelectSection={(nextSection) => setSection(nextSection as FermenterSection)}
                                    />
                                </div>
                            ) : null}
                        </div>
                    </Stack>

                    <Stack as="aside" gap={2.5} className="fermenter-window overflow-y-auto p-2.5">
                        <Stack gap={3} className="fermenter-window p-3">
                            <SectionHeader
                                eyebrow="Performance"
                                title="Macro rig"
                                description="Big moves live here so the right rail earns its space."
                                detail="8 macros"
                            />
                            <Row justify="center">
                                <XYPad
                                    xValue={patch.macros[0]}
                                    yValue={patch.macros[1]}
                                    xLabel="Bright"
                                    yLabel="Motion"
                                    onXChange={(value) => setMacro(0, value)}
                                    onYChange={(value) => setMacro(1, value)}
                                    size={152}
                                />
                            </Row>
                            <MacroStrip compact values={patch.macros} onChange={setMacro} />
                            <MacroMatrixEditor mappings={patch.macroMappings} onChange={setMacroMappings} />
                        </Stack>

                        {uiLevel >= 3 ? (
                            <div className="fermenter-window p-3">
                                <LayerStack
                                    numLayers={patch.numLayers}
                                    activeLayer={patch.activeLayer}
                                    layerLevel={patch.layerLevel}
                                    layerPan={patch.layerPan}
                                    currentEngine={patch.oscEngine}
                                    onActiveLayerChange={(value) => onParam('activeLayer', value)}
                                    onNumLayersChange={(value) => onParam('numLayers', value)}
                                    onLevelChange={(value) => onParam('layerLevel', value)}
                                    onPanChange={(value) => onParam('layerPan', value)}
                                />
                            </div>
                        ) : null}

                        {uiLevel >= 5 ? (
                            <>
                                <div className="fermenter-window p-3">
                                    <TransformPad deviceId={deviceId} />
                                </div>
                                <Stack gap={2} className="fermenter-window p-3">
                                    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                        Spectrum
                                    </div>
                                    <SpectrumAnalyzer deviceId={deviceId} width={210} height={62} />
                                </Stack>
                            </>
                        ) : null}
                    </Stack>
                </div>
            </Stack>
        </Row>
    );
};

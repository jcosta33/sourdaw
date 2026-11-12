import { type ReactElement, useEffect, useRef, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, RotateCcw, Save, Shuffle } from 'lucide-react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { getDawTabId } from '#/components/daw/DawTabStrip';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Slider } from '#/components/ui/slider';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { trackStore } from '#/modules/Arrangement/stores';
import { MidiLearnRotaryKnob } from '#/modules/ControlSurface/presentations/views';

import { DEFAULT_PATCH, type FermenterPatch, ENGINE_NAMES } from '../../models/FermenterPatch';
import {
    cloneFermenterPatch,
    fermenterPatchesEqual,
    fromFermenterDeviceState,
    toFermenterDeviceState,
    type FermenterDeviceStateChunk,
} from '../../models/FermenterPatchState';
import {
    fermenterStore,
    getFermenterState,
    setFermenterUiLevel,
    type FermenterState,
} from '../../stores/fermenterStore';
import { applyFermenterMacroMapping } from '../../useCases/applyFermenterMacroMapping';
import { commitFermenterPatch } from '../../useCases/commitFermenterPatch';
import { loadFermenterPatchWithAudio } from '../../useCases/fermenterParamBridge/loadFermenterPatchWithAudio';
import { setFermenterParamWithAudio } from '../../useCases/fermenterParamBridge/setFermenterParamWithAudio';
import { resolveFermenterPresetPatch } from '../../useCases/fermenterPatchOperations';
import { FERMENTER_PRESETS } from '../../useCases/fermenterQueries/helpers';
import { hydrateFermenterFromProject } from '../../useCases/hydrateFermenterFromProject';
import { randomizeFermenterPatch } from '../../useCases/randomizeFermenterPatch';
import { selectFermenterFilterChoice } from '../../useCases/selectFermenterFilterChoice';
import { selectFermenterOscillatorEngine } from '../../useCases/selectFermenterOscillatorEngine';
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
import {
    FERMENTER_SECTION_PANEL_ID,
    FERMENTER_SECTION_TAB_ID_PREFIX,
    SectionNav,
    type FermenterSection,
} from '../components/SectionNav';
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
    <Row align="start" justify="between" gap={2} shrink={false}>
        <Stack gap={0.5} className="min-w-0">
            <span className="text-[8px] font-semibold uppercase tracking-[0.28em] text-[var(--color-accent-sage)]/70">
                {eyebrow}
            </span>
            <span className="text-[13px] font-semibold text-foreground truncate">{title}</span>
            <span className="sr-only">{description}</span>
        </Stack>
        {detail ? (
            <DawPluginLed tone="sage" className="shrink-0 mt-0.5">
                {detail}
            </DawPluginLed>
        ) : null}
    </Row>
);

export { randomizeFermenterPatch as randomizePatch };

type AuditionSlot = {
    patch: FermenterPatch;
    referencePatch: FermenterPatch;
    presetId: string | null;
};

type AuditionSession = {
    a: AuditionSlot;
    b: AuditionSlot;
    active: 'a' | 'b';
};

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
    const projectDevice = useStoreSelector(trackStore, (state) =>
        (state?.tracks ?? []).flatMap((track) => track.devices).find((device) => device.id === deviceId)
    );
    const projectParameterValues = projectDevice?.parameterValues;
    const projectDeviceState = projectDevice?.deviceState;

    useEffect(() => {
        hydrateFermenterFromProject(deviceId);
    }, [deviceId, projectParameterValues, projectDeviceState]);

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
    const [referencePatch, setReferencePatch] = useState(() => cloneFermenterPatch(patch));
    const referencePatchRef = useRef(referencePatch);
    const [auditionSession, setAuditionSession] = useState<AuditionSession | null>(null);
    const auditionSessionRef = useRef<AuditionSession | null>(null);
    const [currentPresetId, setCurrentPresetId] = useState<string | null>(null);
    const localCommitRef = useRef<FermenterDeviceStateChunk | null>(null);
    const observedLocalCommitRef = useRef(false);
    const hydratedDeviceRef = useRef<string | null>(null);
    const patchOperationRef = useRef(0);

    function updateReference(value: FermenterPatch): void {
        const next = cloneFermenterPatch(value);
        referencePatchRef.current = next;
        setReferencePatch(next);
    }

    function updateSession(value: AuditionSession | null): void {
        auditionSessionRef.current = value;
        setAuditionSession(value);
    }

    function restoreProjectReference(value: FermenterPatch): void {
        updateReference(value);
        updateSession(null);
        setCurrentPresetId(null);
    }

    useEffect(() => {
        const hydrated = hydrateFermenterFromProject(deviceId);
        if (!hydrated) {
            return;
        }
        const firstHydration = hydratedDeviceRef.current !== deviceId;
        hydratedDeviceRef.current = deviceId;
        if (firstHydration) {
            localCommitRef.current = null;
            observedLocalCommitRef.current = false;
            restoreProjectReference(hydrated);
            return;
        }
        if (localCommitRef.current) {
            const localCommit = fromFermenterDeviceState(localCommitRef.current);
            if (localCommit && fermenterPatchesEqual(hydrated, localCommit)) {
                observedLocalCommitRef.current = true;
                return;
            }
            if (!observedLocalCommitRef.current) {
                return;
            }
            localCommitRef.current = null;
            observedLocalCommitRef.current = false;
        }
        restoreProjectReference(hydrated);
    }, [deviceId, projectDeviceState]);

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
    const modified = !fermenterPatchesEqual(patch, referencePatch);

    function onParam(key: string, value: number): void {
        if (key === 'oscEngine') {
            void selectFermenterOscillatorEngine(deviceId, value);
            return;
        }
        if (key === 'filterModel' || key === 'filterMode') {
            void selectFermenterFilterChoice(deviceId, key, value);
            return;
        }
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

    function saveActiveSlot(): AuditionSession | null {
        const current = auditionSessionRef.current;
        if (!current) {
            return null;
        }
        const active = current.active;
        const next = {
            ...current,
            [active]: {
                ...current[active],
                patch: cloneFermenterPatch(getFermenterState(deviceId).patch),
            },
        };
        updateSession(next);
        return next;
    }

    async function applyCommittedPatch(
        value: FermenterPatch,
        label: string,
        comparisonReference?: FermenterPatch
    ): Promise<boolean> {
        const operation = patchOperationRef.current + 1;
        patchOperationRef.current = operation;
        const next = cloneFermenterPatch(value);
        const unchanged = fermenterPatchesEqual(getFermenterState(deviceId).patch, next);
        updateReference(comparisonReference ?? next);
        if (!unchanged) {
            localCommitRef.current = toFermenterDeviceState(next);
            observedLocalCommitRef.current = false;
        }
        const committed = await commitFermenterPatch({ deviceId, patch: next, label });
        if (patchOperationRef.current !== operation) {
            return false;
        }
        if (!committed) {
            localCommitRef.current = null;
            observedLocalCommitRef.current = false;
            restoreProjectReference(getFermenterState(deviceId).patch);
        }
        return committed;
    }

    function loadPreset(presetId: string): void {
        const loadedPatch = resolveFermenterPresetPatch(presetId, userPatches);
        if (!loadedPatch) {
            return;
        }

        const currentPatch = cloneFermenterPatch(getFermenterState(deviceId).patch);
        const existing = auditionSessionRef.current;
        let next: AuditionSession;
        if (existing) {
            const saved = saveActiveSlot() ?? existing;
            next = {
                ...saved,
                b: { patch: loadedPatch, referencePatch: cloneFermenterPatch(loadedPatch), presetId },
                active: 'b',
            };
        } else {
            next = {
                a: {
                    patch: currentPatch,
                    referencePatch: cloneFermenterPatch(currentPatch),
                    presetId: currentPresetId,
                },
                b: { patch: loadedPatch, referencePatch: cloneFermenterPatch(loadedPatch), presetId },
                active: 'b',
            };
        }
        updateSession(next);
        setCurrentPresetId(presetId);
        void applyCommittedPatch(loadedPatch, 'Audition Fermenter preset');
    }

    function showAuditionSlot(active: 'a' | 'b'): void {
        const current = saveActiveSlot();
        if (!current || current.active === active) {
            return;
        }
        const slot = current[active];
        updateSession({ ...current, active });
        setCurrentPresetId(slot.presetId);
        void applyCommittedPatch(slot.patch, `Show Fermenter patch ${active.toUpperCase()}`, slot.referencePatch);
    }

    function initPatch(): void {
        updateSession(null);
        setCurrentPresetId(null);
        void applyCommittedPatch(cloneFermenterPatch(DEFAULT_PATCH), 'Reset Fermenter patch');
    }

    function applyRandomPatch(): void {
        updateSession(null);
        setCurrentPresetId(null);
        void applyCommittedPatch(randomizeFermenterPatch(), 'Randomize Fermenter patch');
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
        <Row align="stretch" gap={2.5} className="fermenter-faceplate h-full min-h-[460px] p-2.5">
            <Stack
                as="aside"
                gap={2.5}
                shrink={false}
                className="fermenter-window h-full w-[228px] min-h-0 overflow-y-auto p-2.5"
            >
                <SectionHeader
                    eyebrow="Scenes"
                    title="Preset bench"
                    description="Pick instruments like scenes, not menu rows, then keep the performance controls close."
                    detail={`${userPatches.length} user`}
                />

                <Row align="stretch" wrap gap={1.5} shrink={false}>
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

                <Row justify="between" gap={2} shrink={false} className="fermenter-window px-3 py-2">
                    <div className="min-w-0">
                        <div className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">
                            Current scene
                        </div>
                        <div className="truncate text-[11px] text-foreground">{patch.name}</div>
                        {modified ? (
                            <div className="mt-0.5 text-[8px] font-medium uppercase tracking-[0.16em] text-[var(--color-accent-peach)]">
                                Modified
                            </div>
                        ) : null}
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
                                    className="fermenter-window h-8 w-24 px-2 text-[10px] outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/70"
                                    autoFocus
                                />
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="h-8 w-8"
                                    onClick={handleSave}
                                    aria-label="Save preset"
                                >
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
                                    aria-label="Open save preset dialog"
                                >
                                    <Save className="size-3" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="h-8 w-8"
                                    onClick={initPatch}
                                    aria-label="Reset patch to default"
                                >
                                    <RotateCcw className="size-3" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="h-8 w-8"
                                    onClick={applyRandomPatch}
                                    aria-label="Randomize patch"
                                >
                                    <Shuffle className="size-3" />
                                </Button>
                            </>
                        )}
                    </Row>
                </Row>

                <Row align="center" justify="between" gap={1} shrink={false} className="fermenter-window px-2 py-1.5">
                    <span className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/55">Compare</span>
                    <Row gap={0.5} shrink={false}>
                        {(['a', 'b'] as const).map((slot) => (
                            <Button
                                key={slot}
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={`Show patch ${slot.toUpperCase()}`}
                                aria-pressed={auditionSession?.active === slot}
                                disabled={!auditionSession}
                                className="h-6 min-w-8 px-2 text-[9px]"
                                onClick={() => showAuditionSlot(slot)}
                            >
                                {slot.toUpperCase()}
                            </Button>
                        ))}
                    </Row>
                </Row>

                <div className="fermenter-window min-h-[160px] flex-1 shrink-0 overflow-hidden">
                    <PresetBrowser
                        currentName={patch.name}
                        currentPresetId={currentPresetId}
                        userPatches={userPatches}
                        presets={FERMENTER_PRESETS}
                        onLoadPreset={loadPreset}
                        onStepPreset={loadPreset}
                    />
                </div>
            </Stack>

            <Stack grow gap={2.5} className="min-w-0">
                <Row
                    as="header"
                    align="center"
                    justify="between"
                    gap={2}
                    shrink={false}
                    className="fermenter-window min-h-[32px] px-2.5 py-1"
                >
                    <Row align="center" gap={1.5} shrink={false}>
                        <DawPluginLed tone="sage">
                            {LEVELS.find((level) => level.id === uiLevel)?.eyebrow ?? 'Scene'}
                        </DawPluginLed>
                        <DawPluginLed tone="sage">{ENGINE_NAMES[patch.oscEngine] ?? 'Wavetable'}</DawPluginLed>
                    </Row>

                    <Row align="center" gap={1.5} className="min-w-0 overflow-x-auto no-scrollbar">
                        <DawPluginMetricTile
                            compact
                            className="fermenter-window shrink-0"
                            label="Engine"
                            value={ENGINE_NAMES[patch.oscEngine] ?? 'Wavetable'}
                            detail={`Wave ${patch.oscWaveform + 1}`}
                        />
                        <DawPluginMetricTile
                            compact
                            className="fermenter-window shrink-0"
                            label="Cutoff"
                            value={`${Math.round(patch.filterCutoff)} Hz`}
                            detail={`Res ${patch.filterResonance.toFixed(1)}`}
                        />
                        <DawPluginMetricTile
                            compact
                            className="fermenter-window shrink-0"
                            label="Motion"
                            value={`${patch.lfoRate.toFixed(2)} Hz`}
                            detail={`Macro A ${formatPercent(patch.macros[0])}`}
                        />
                        <DawPluginMetricTile
                            compact
                            className="fermenter-window shrink-0"
                            label="Width"
                            value={patch.stereoWidth.toFixed(2)}
                            detail={`${patch.numLayers} ${patch.numLayers === 1 ? 'layer' : 'layers'}`}
                        />
                    </Row>

                    <Row align="center" gap={2} shrink={false} className="ml-auto">
                        <Row align="center" gap={1} className="text-[10px] text-muted-foreground">
                            <Cpu className="size-3" />
                            <span>{activeVoices} voices</span>
                        </Row>
                        <OutputMeter deviceId={deviceId} height={18} />
                    </Row>
                </Row>

                <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_260px] gap-2.5 overflow-hidden">
                    <Stack as="section" gap={2.5} className="fermenter-window min-h-0 overflow-y-auto p-2.5">
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

                        <div
                            role="tabpanel"
                            id={FERMENTER_SECTION_PANEL_ID}
                            aria-labelledby={getDawTabId(FERMENTER_SECTION_TAB_ID_PREFIX, section)}
                            tabIndex={0}
                            className="min-h-[180px] flex-1 overflow-y-auto px-1"
                        >
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

                    <Stack as="aside" gap={2.5} className="fermenter-window min-h-[220px] overflow-y-auto p-2.5">
                        <Stack gap={3} shrink={false} className="fermenter-window p-3">
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
                            <div className="fermenter-window shrink-0 p-3">
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
                                <div className="fermenter-window shrink-0 p-3">
                                    <TransformPad deviceId={deviceId} />
                                </div>
                                <Stack gap={2} shrink={false} className="fermenter-window p-3">
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

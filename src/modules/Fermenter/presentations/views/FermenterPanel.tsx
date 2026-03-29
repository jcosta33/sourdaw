/**
 * Fermenter — master synth panel.
 *
 * Horizontal-first layout optimized for wide bottom panels:
 *
 *   ┌─────────────────────────────────────────────────────────────────────────┐
 *   │ Top bar: preset actions · level switcher · oscilloscope · voice meter  │
 *   ├──────────┬──────────────────────────────────────┬───────────────────────┤
 *   │ Left:    │  Center: section tabs + content      │  Right (Level 3+):   │
 *   │ Preset   │  [Osc] [Filter] [Env] [Mod] [FX]    │  XY Pad / Layer      │
 *   │ Browser  │  ┌──────────────────────────────┐    │  Stack / Lab tools   │
 *   │ OR       │  │ Active section with visual   │    │                      │
 *   │ Macros   │  │ + knobs side by side         │    │                      │
 *   │          │  └──────────────────────────────┘    │                      │
 *   └──────────┴──────────────────────────────────────┴───────────────────────┘
 *
 * Level 1: Left=macros+XY, Center=hidden, Right=hidden
 * Level 2: Left=preset browser, Center=section tabs, Right=macros+XY
 * Level 3: Left=preset browser, Center=section tabs, Right=layer stack+XY
 * Level 4: Center gets signal flow at bottom
 * Level 5: Right gets transform pad + spectrum
 */
import { type ReactElement, useCallback, useState, useSyncExternalStore } from 'react';
import { Cpu, RotateCcw, Save, Shuffle } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { ScrollArea } from '#/components/ui/scroll-area';
import {
    fermenterStore, setFermenterUiLevel, loadFermenterPatch, type FermenterState,
} from '../../stores/fermenterStore';
import { type FermenterPatch, DEFAULT_PATCH } from '../../models/FermenterPatch';
import { setFermenterParamWithAudio } from '../../useCases/fermenterParamBridge';
import { FERMENTER_PRESETS } from '../../useCases/fermenterQueries';

import { MacroStrip } from '../components/MacroStrip';
import { XYPad } from '../components/XYPad';
import { Oscilloscope } from '../components/Oscilloscope';
import { OutputMeter } from '../components/OutputMeter';
import { PresetBrowser } from '../components/PresetBrowser';
import { SectionNav, type FermenterSection } from '../components/SectionNav';
import { OscillatorSection } from '../components/OscillatorSection';
import { FilterSection } from '../components/FilterSection';
import { EnvelopeSection } from '../components/EnvelopeSection';
import { UnisonSection } from '../components/UnisonSection';
import { FmSection } from '../components/FmSection';
import { KarplusSection } from '../components/KarplusSection';
import { GranularSection } from '../components/GranularSection';
import { AdditiveSection } from '../components/AdditiveSection';
import { SamplerSection } from '../components/SamplerSection';
import { LfoSection } from '../components/LfoSection';
import { WarpSection } from '../components/WarpSection';
import { ModulationSection } from '../components/ModulationSection';
import { EffectsSection } from '../components/EffectsSection';
import { LayerStack } from '../components/LayerStack';
import { SignalFlowView } from '../components/SignalFlowView';
import { TransformPad } from './TransformPad';
import { SpectrumAnalyzer } from '../components/SpectrumAnalyzer';

// ── Preset persistence ──────────────────────────────────────────────
const USER_PATCHES_KEY = 'fermenter-user-patches';
function loadUserPatches(): Array<{ id: string; name: string; patch: FermenterPatch }> {
    try { return JSON.parse(localStorage.getItem(USER_PATCHES_KEY) ?? '[]'); } catch { return []; }
}
function saveUserPatch(name: string, patch: FermenterPatch): void {
    const patches = loadUserPatches();
    patches.push({ id: `user-${Date.now()}`, name, patch: { ...patch, name } });
    localStorage.setItem(USER_PATCHES_KEY, JSON.stringify(patches));
}

// ── Component ───────────────────────────────────────────────────────
export const FermenterPanel = (): ReactElement => {
    const state = useSyncExternalStore<FermenterState | null>(
        (cb) => fermenterStore.subscribe(cb), () => fermenterStore.value,
    );
    const patch = state?.patch ?? fermenterStore.value!.patch;
    const uiLevel = state?.uiLevel ?? 1;
    const activeVoices = state?.activeVoices ?? 0;
    const scopeBuffer = state?.scopeBuffer ?? null;
    const peakL = state?.peakL ?? 0;
    const peakR = state?.peakR ?? 0;

    const [section, setSection] = useState<FermenterSection>('osc');
    const [showSave, setShowSave] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [upVer, setUpVer] = useState(0);
    const userPatches = loadUserPatches(); void upVer;

    const setParam = useCallback((key: keyof FermenterPatch, value: number) => setFermenterParamWithAudio(key, value), []);
    const onParam = useCallback((key: string, value: number) => setFermenterParamWithAudio(key as keyof FermenterPatch, value), []);

    const setMacro = useCallback((index: number, value: number) => {
        // Update store with new macro array
        const macros = [...patch.macros] as FermenterPatch['macros'];
        macros[index] = value;
        loadFermenterPatch({ ...patch, macros });
        // Macros don't map to Rust params yet — they're performance controllers
        // that will eventually map to synth params via the macro routing system
    }, [patch]);

    const loadPreset = useCallback((presetId: string) => {
        const up = userPatches.find((p) => p.id === presetId);
        const src = up ? up.patch : (() => {
            const pr = FERMENTER_PRESETS.find((p) => p.id === presetId);
            if (!pr) return null;
            const pv = pr.devices[0]?.parameterValues; if (!pv) return null;
            const np: FermenterPatch = { ...DEFAULT_PATCH, name: pr.name };
            for (const [k, v] of Object.entries(pv)) { if (k in np && typeof v === 'number') (np as Record<string, unknown>)[k] = v; }
            return np;
        })();
        if (!src) return;
        loadFermenterPatch(src);
        for (const [k, v] of Object.entries(src)) { if (typeof v === 'number') setFermenterParamWithAudio(k as keyof FermenterPatch, v); }
    }, [userPatches]);

    const initPatch = useCallback(() => {
        loadFermenterPatch({ ...DEFAULT_PATCH });
        for (const [k, v] of Object.entries(DEFAULT_PATCH)) { if (typeof v === 'number') setFermenterParamWithAudio(k as keyof FermenterPatch, v); }
    }, []);

    const randomizePatch = useCallback(() => {
        const r = (a: number, b: number) => a + Math.random() * (b - a);
        const ri = (a: number, b: number) => Math.floor(r(a, b + 1));
        const p: FermenterPatch = { ...DEFAULT_PATCH, name: 'Random', oscEngine: ri(0, 5), oscWaveform: ri(0, 3), oscLevel: r(0.5, 1), filterModel: ri(0, 5), filterCutoff: r(200, 12000), filterResonance: r(0.5, 8), ampAttack: r(0.001, 0.5), ampDecay: r(0.05, 1), ampSustain: r(0, 1), ampRelease: r(0.05, 2), filterEnvAmount: r(-0.8, 0.8), reverbMix: r(0, 0.6), masterGain: r(0.6, 1), macros: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] };
        loadFermenterPatch(p);
        for (const [k, v] of Object.entries(p)) { if (typeof v === 'number') setFermenterParamWithAudio(k as keyof FermenterPatch, v); }
    }, []);

    const handleSave = useCallback(() => {
        if (!saveName.trim()) return;
        saveUserPatch(saveName.trim(), patch);
        setSaveName(''); setShowSave(false); setUpVer((v) => v + 1);
    }, [saveName, patch]);

    // ── Engine-specific sub-panel ────────────────────────────────────
    const engineControls = (): ReactElement | null => {
        switch (patch.oscEngine) {
            case 2: return <FmSection algorithm={patch.fmAlgorithm} ratios={[patch.fmRatio1, patch.fmRatio2, patch.fmRatio3, patch.fmRatio4]} levels={[patch.fmLevel1, patch.fmLevel2, patch.fmLevel3, patch.fmLevel4]} feedback={patch.fmFeedback} modAmount={patch.fmModAmount} onParam={onParam} />;
            case 3: return <KarplusSection damping={patch.ksDamping} brightness={patch.ksBrightness} onDampingChange={(v) => setParam('ksDamping', v)} onBrightnessChange={(v) => setParam('ksBrightness', v)} />;
            case 4: return <GranularSection density={patch.grainDensity} size={patch.grainSize} position={patch.grainPosition} spray={patch.grainSpray} pitchVar={patch.grainPitchVar} panSpread={patch.grainPanSpread} onParam={onParam} />;
            case 5: return <AdditiveSection partials={patch.additivePartials} tilt={patch.additiveTilt} oddEmphasis={patch.additiveOdd} inharmonicity={patch.additiveInharm} onParam={onParam} />;
            case 6: return <SamplerSection mode={patch.samplerMode} start={patch.samplerStart} end={patch.samplerEnd} onParam={onParam} />;
            default: return <UnisonSection voices={patch.unisonVoices} detune={patch.unisonDetune} spread={patch.unisonSpread} onVoicesChange={(v) => setParam('unisonVoices', v)} onDetuneChange={(v) => setParam('unisonDetune', v)} onSpreadChange={(v) => setParam('unisonSpread', v)} />;
        }
    };

    // ── Section content ──────────────────────────────────────────────
    const sectionContent = (): ReactElement => {
        switch (section) {
            case 'osc': return (
                <div className="flex gap-4 items-start flex-wrap">
                    <OscillatorSection engine={patch.oscEngine} waveform={patch.oscWaveform} level={patch.oscLevel} coarse={patch.oscCoarse} fine={patch.oscFine} pulseWidth={patch.pulseWidth} noiseLevel={patch.noiseLevel} noiseColor={patch.noiseColor} onEngineChange={(v) => setParam('oscEngine', v)} onWaveformChange={(v) => setParam('oscWaveform', v)} onLevelChange={(v) => setParam('oscLevel', v)} onCoarseChange={(v) => setParam('oscCoarse', v)} onFineChange={(v) => setParam('oscFine', v)} onPulseWidthChange={(v) => setParam('pulseWidth', v)} onNoiseLevelChange={(v) => setParam('noiseLevel', v)} onNoiseColorChange={(v) => setParam('noiseColor', v)} />
                    <div className="border-l border-border/15 pl-4">{engineControls()}</div>
                    <div className="border-l border-border/15 pl-4"><WarpSection warpMode={patch.warpMode} warpAmount={patch.warpAmount} audioModRate={patch.audioModRate} audioModDepth={patch.audioModDepth} audioModTarget={patch.audioModTarget} onParam={onParam} /></div>
                </div>
            );
            case 'filter': return (
                <FilterSection model={patch.filterModel} cutoff={patch.filterCutoff} resonance={patch.filterResonance} mode={patch.filterMode} envAmount={patch.filterEnvAmount} drive={patch.filterDrive} keytrack={patch.filterKeytrack} onModelChange={(v) => setParam('filterModel', v)} onCutoffChange={(v) => setParam('filterCutoff', v)} onResonanceChange={(v) => setParam('filterResonance', v)} onModeChange={(v) => setParam('filterMode', v)} onEnvAmountChange={(v) => setParam('filterEnvAmount', v)} onDriveChange={(v) => setParam('filterDrive', v)} onKeytrackChange={(v) => setParam('filterKeytrack', v)} />
            );
            case 'env': return (
                <div className="flex gap-4 items-start flex-wrap">
                    <EnvelopeSection ampA={patch.ampAttack} ampD={patch.ampDecay} ampS={patch.ampSustain} ampR={patch.ampRelease} filterA={patch.filterAttack} filterD={patch.filterDecay} filterS={patch.filterSustain} filterR={patch.filterRelease} onAmpChange={(k, v) => setParam(k, v)} onFilterChange={(k, v) => setParam(k, v)} />
                    <div className="border-l border-border/15 pl-4"><LfoSection rate={patch.lfoRate} shape={patch.lfoShape} pitchAmount={patch.lfoPitchAmount} filterAmount={patch.lfoFilterAmount} onRateChange={(v) => setParam('lfoRate', v)} onShapeChange={(v) => setParam('lfoShape', v)} onPitchAmountChange={(v) => setParam('lfoPitchAmount', v)} onFilterAmountChange={(v) => setParam('lfoFilterAmount', v)} /></div>
                </div>
            );
            case 'mod': return (
                <div className="flex gap-6 items-start">
                    <ModulationSection msegToFilter={patch.msegToFilter} seqRate={patch.seqRate} seqToPitch={patch.seqToPitch} onParam={onParam} />
                    <div className="border-l border-border/20 pl-4 space-y-2">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Portamento</div>
                        <div className="flex items-end gap-2">
                            <div className="flex flex-col items-center gap-0.5">
                                <span className="text-[8px] text-muted-foreground">{patch.portamentoTime === 0 ? 'Off' : `${(patch.portamentoTime * 1000).toFixed(0)}ms`}</span>
                            </div>
                        </div>
                    </div>
                </div>
            );
            case 'fx': return (
                <EffectsSection
                    reverbMix={patch.reverbMix} reverbDecay={patch.reverbDecay}
                    delayTime={patch.delayTime} delayFeedback={patch.delayFeedback} delayMix={patch.delayMix}
                    chorusRate={patch.chorusRate} chorusDepth={patch.chorusDepth} chorusMix={patch.chorusMix}
                    phaserRate={patch.phaserRate} phaserDepth={patch.phaserDepth} phaserMix={patch.phaserMix}
                    distDrive={patch.distDrive} distTone={patch.distTone} distMix={patch.distMix}
                    compThreshold={patch.compThreshold} compRatio={patch.compRatio} compAttack={patch.compAttack} compRelease={patch.compRelease} compMix={patch.compMix}
                    stereoWidth={patch.stereoWidth} masterGain={patch.masterGain}
                    eqLowFreq={patch.eqLowFreq} eqLowGain={patch.eqLowGain} eqLowQ={patch.eqLowQ}
                    eqMidFreq={patch.eqMidFreq} eqMidGain={patch.eqMidGain} eqMidQ={patch.eqMidQ}
                    eqHighFreq={patch.eqHighFreq} eqHighGain={patch.eqHighGain} eqHighQ={patch.eqHighQ}
                    onParam={onParam}
                />
            );
        }
    };

    // ── Macro XY + strip (compact for sidebar use) ───────────────────
    const macroPanel = (compact: boolean): ReactElement => (
        <div className="space-y-2 p-2">
            <XYPad
                xValue={patch.macros[0]} yValue={patch.macros[1]}
                xLabel="Bright" yLabel="Motion"
                onXChange={(v) => setMacro(0, v)}
                onYChange={(v) => setMacro(1, v)}
                size={compact ? 130 : 160}
            />
            <MacroStrip compact={compact} values={patch.macros} onChange={setMacro} />
        </div>
    );

    // ═══════════════════════════════════════════════════════════════════
    // LAYOUT
    // ═══════════════════════════════════════════════════════════════════

    return (
        <div className="flex flex-col h-full">
            {/* ─── Top bar ─── */}
            <div className="flex items-center justify-between px-3 py-1 shrink-0 border-b border-border/30 bg-surface-app/30">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-[var(--color-accent-lavender)] tracking-tight">{patch.name}</span>
                    {showSave ? (
                        <div className="flex items-center gap-1">
                            <input type="text" value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowSave(false); }} placeholder="Name…" className="h-5 w-20 rounded border border-border/40 bg-surface-inset px-1.5 text-[9px] outline-none" autoFocus />
                            <Button variant="ghost" size="icon-xs" className="h-5 w-5" onClick={handleSave}><Save className="size-3" /></Button>
                        </div>
                    ) : (
                        <div className="flex gap-0.5">
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" className="h-5 w-5" onClick={() => { setSaveName(patch.name === 'Init' ? '' : patch.name); setShowSave(true); }}><Save className="size-2.5" /></Button></TooltipTrigger><TooltipContent>Save</TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" className="h-5 w-5" onClick={initPatch}><RotateCcw className="size-2.5" /></Button></TooltipTrigger><TooltipContent>Init</TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" className="h-5 w-5" onClick={randomizePatch}><Shuffle className="size-2.5" /></Button></TooltipTrigger><TooltipContent>Random</TooltipContent></Tooltip>
                        </div>
                    )}
                </div>
                <div className="flex gap-0.5 bg-surface-base/50 rounded p-0.5">
                    {(['Play', 'Shape', 'Build', 'Route', 'Lab'] as const).map((label, i) => {
                        const lvl = (i + 1) as 1 | 2 | 3 | 4 | 5;
                        return <button key={label} type="button" className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors ${uiLevel === lvl ? 'bg-[var(--color-accent-lavender)] text-white' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setFermenterUiLevel(lvl)}>{label}</button>;
                    })}
                </div>
                <div className="flex items-center gap-2">
                    <Oscilloscope buffer={scopeBuffer} width={80} height={20} />
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground"><Cpu className="size-3" /><span>{activeVoices}v</span></div>
                    <OutputMeter peakL={peakL} peakR={peakR} height={20} />
                </div>
            </div>

            {/* ─── Main body ─── */}
            {uiLevel === 1 ? (
                /* Level 1: Just macros + XY — full width, centered, zen */
                <div className="flex-1 flex items-center justify-center">
                    {macroPanel(false)}
                </div>
            ) : (
                /* Level 2+: Three-column layout */
                <div className="flex flex-1 min-h-0 overflow-hidden">
                    {/* LEFT: Preset browser (Level 2+) or Layer stack (Level 3+) */}
                    <div className="w-[180px] shrink-0 border-r border-border/20 flex flex-col overflow-hidden">
                        {uiLevel >= 3 ? (
                            <>
                                <div className="shrink-0 border-b border-border/20">
                                    <LayerStack numLayers={patch.numLayers} activeLayer={patch.activeLayer} layerLevel={patch.layerLevel} layerPan={patch.layerPan} currentEngine={patch.oscEngine} onActiveLayerChange={(v) => setParam('activeLayer', v)} onNumLayersChange={(v) => setParam('numLayers', v)} onLevelChange={(v) => setParam('layerLevel', v)} onPanChange={(v) => setParam('layerPan', v)} />
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <PresetBrowser 
                                        currentName={patch.name} 
                                        userPatches={userPatches} 
                                        presets={FERMENTER_PRESETS}
                                        onLoadPreset={loadPreset} 
                                    />
                                </div>
                            </>
                        ) : (
                            <PresetBrowser 
                                currentName={patch.name} 
                                userPatches={userPatches} 
                                presets={FERMENTER_PRESETS}
                                onLoadPreset={loadPreset} 
                            />
                        )}
                    </div>

                    {/* CENTER: Section tabs + content */}
                    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                        <div className="px-2 py-1 border-b border-border/20 shrink-0">
                            <SectionNav active={section} onChange={setSection} />
                        </div>
                        <ScrollArea className="flex-1 min-h-0">
                            <div className="p-3">{sectionContent()}</div>
                        </ScrollArea>
                        {/* Signal flow (Level 4+) */}
                        {uiLevel >= 4 ? (
                            <div className="border-t border-border/20 shrink-0 overflow-x-auto px-3 py-1">
                                <SignalFlowView patch={patch} numLayers={patch.numLayers} activeLayer={patch.activeLayer} onSelectSection={(s) => setSection(s as FermenterSection)} />
                            </div>
                        ) : null}
                    </div>

                    {/* RIGHT: Macros/XY + Lab tools */}
                    <div className="w-[150px] shrink-0 border-l border-border/20 overflow-y-auto overflow-x-hidden">
                        {macroPanel(true)}
                        {/* Lab tools (Level 5) */}
                        {uiLevel >= 5 ? (
                            <div className="p-2 border-t border-border/20 space-y-2">
                                <TransformPad />
                                <div className="space-y-1">
                                    <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Spectrum</div>
                                    <SpectrumAnalyzer buffer={scopeBuffer} width={140} height={50} />
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            )}
        </div>
    );
};

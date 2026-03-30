/**
 * Gluten — multi-topology bus compressor panel.
 *
 * Layout:
 *   Top bar: topology selector + style presets + preset browser
 *   Left: interactive transfer curve + GR meter
 *   Right: controls organized by topology context
 */
import { type ReactElement, useCallback, useSyncExternalStore } from 'react';
import { useState } from 'react';
import { ChevronDown, Zap, Sun, Flame, Radio } from 'lucide-react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { glutenStore, type GlutenState } from '../../stores/glutenStore';
import { setGlutenParamWithAudio } from '../../useCases/glutenParamBridge';
import { GLUTEN_PRESETS } from '../../useCases/glutenPresets';
import { loadGlutenPatch } from '../../stores/glutenStore';
import { GlutenCurve } from '../components/GlutenCurve';
import { GrMeter } from '../components/GrMeter';
import { GrHistory } from '../components/GrHistory';
import { type GlutenTopology } from '../../models/GlutenPatch';

const TOPOLOGY_META: Record<GlutenTopology, { label: string; icon: typeof Zap; color: string; description: string }> = {
    vca: { label: 'VCA', icon: Zap, color: 'var(--color-accent-peach)', description: 'SSL G-Bus · Clean glue' },
    opto: { label: 'Opto', icon: Sun, color: 'var(--color-accent-mint)', description: 'LA-2A · Smooth leveling' },
    fet: { label: 'FET', icon: Flame, color: 'var(--color-state-danger)', description: '1176 · Fast & punchy' },
    diode: { label: 'Diode', icon: Radio, color: 'var(--color-accent-lavender)', description: 'Neve 33609 · Warm & thick' },
};

const TOPOLOGIES: GlutenTopology[] = ['vca', 'opto', 'fet', 'diode'];

const K = ({ v, k, label, min, max, step, def, unit }: {
    v: number; k: string; label: string; min: number; max: number; step: number; def: number; unit?: string;
}): ReactElement => (
    <div className="flex flex-col items-center gap-0">
        <RotaryKnob value={v} onChange={(val) => setGlutenParamWithAudio(k as never, val)} min={min} max={max} step={step} defaultValue={def} size="sm" />
        <span className="text-[7px] text-muted-foreground leading-none">{label}</span>
        {unit ? <span className="text-[6px] text-muted-foreground/40 font-mono">{formatValue(v, unit)}</span> : null}
    </div>
);

function formatValue(v: number, unit: string): string {
    if (unit === 'dB') return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
    if (unit === 'ms') return v < 1 ? `${(v * 1000).toFixed(0)}µs` : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v.toFixed(0)}ms`;
    if (unit === ':1') return v >= 20 ? '∞:1' : `${v.toFixed(1)}:1`;
    if (unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`;
    return `${v.toFixed(2)}`;
}

export const GlutenPanel = (): ReactElement => {
    const state = useSyncExternalStore<GlutenState | null>(
        (cb) => glutenStore.subscribe(cb), () => glutenStore.value,
    );

    const [presetMenuOpen, setPresetMenuOpen] = useState(false);

    const patch = state?.patch ?? glutenStore.value!.patch;
    const grDb = state?.grDb ?? 0;
    const inputDb = state?.inputDb ?? -100;
    const outputDb = state?.outputDb ?? -100;
    const crest = state?.crest ?? 0;
    const phaseCorr = state?.phaseCorr ?? 1;
    const latency = state?.latency ?? 0;

    const topoMeta = TOPOLOGY_META[patch.topology];
    const topoColor = topoMeta.color;

    const setP = useCallback((key: string, value: number) => {
        setGlutenParamWithAudio(key as never, value);
    }, []);

    return (
        <div className="flex flex-col h-full">
            {/* ─── Top bar: topology + presets ─── */}
            <div
                className="flex items-center gap-3 px-2 py-1 shrink-0"
                style={{
                    background: 'linear-gradient(180deg, rgba(20,20,22,0.95) 0%, rgba(14,14,16,0.95) 100%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 3px rgba(0,0,0,0.5)',
                    borderBottom: '1px solid rgba(0,0,0,0.4)',
                }}
            >
                {/* Topology selector */}
                <div className="flex gap-0.5">
                    {TOPOLOGIES.map((topo) => {
                        const meta = TOPOLOGY_META[topo];
                        const Icon = meta.icon;
                        const active = patch.topology === topo;
                        return (
                            <button
                                key={topo}
                                type="button"
                                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium transition-all ${
                                    active ? 'text-white' : 'text-muted-foreground/60 hover:text-foreground'
                                }`}
                                style={active ? { backgroundColor: meta.color } : undefined}
                                onClick={() => setP('topology', TOPOLOGIES.indexOf(topo))}
                                title={meta.description}
                            >
                                <Icon className="size-3" />
                                {meta.label}
                            </button>
                        );
                    })}
                </div>

                <div className="w-px h-4 shrink-0" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 100%)' }} />

                {/* Preset selector */}
                <div className="relative shrink-0">
                    <button
                        type="button"
                        className="flex items-center gap-1 appearance-none bg-surface-inset border border-border/40 rounded px-2 py-0.5 text-[10px] text-foreground font-medium cursor-pointer min-w-[120px]"
                        onClick={() => setPresetMenuOpen(!presetMenuOpen)}
                    >
                        <span className="truncate flex-1 text-left">{patch.name}</span>
                        <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                    </button>
                    {presetMenuOpen ? (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-surface-raised border border-border/40 rounded-md shadow-lg py-0.5 min-w-[160px] max-h-[200px] overflow-y-auto">
                            {GLUTEN_PRESETS.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    className={`w-full text-left px-2 py-1 text-[9px] hover:bg-surface-inset transition-colors ${
                                        preset.patch.name === patch.name ? 'text-foreground font-medium' : 'text-foreground/70'
                                    }`}
                                    onClick={() => { loadGlutenPatch(preset.patch); setPresetMenuOpen(false); }}
                                >
                                    <span className="block truncate">{preset.name}</span>
                                    <span className="text-[7px] text-muted-foreground/40">{preset.category}</span>
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>

                {/* Quick style buttons */}
                <div className="flex gap-0.5">
                    {(['glue', 'punch', 'smooth', 'pump'] as const).map((style, i) => (
                        <button
                            key={style}
                            type="button"
                            className="px-1.5 py-0.5 rounded text-[7px] font-medium text-muted-foreground/50 hover:text-foreground hover:bg-surface-raised transition-colors capitalize"
                            onClick={() => setP('style', i)}
                        >
                            {style}
                        </button>
                    ))}
                </div>

                <div className="flex-1" />

                {/* Auto toggles */}
                <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                    <input
                        type="checkbox"
                        checked={patch.autoRelease}
                        onChange={(e) => setP('autoRelease', e.target.checked ? 1 : 0)}
                        className="size-2.5 rounded accent-current"
                        style={{ accentColor: topoColor }}
                    />
                    Auto Rel
                </label>
                <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                    <input
                        type="checkbox"
                        checked={patch.autoMakeup}
                        onChange={(e) => setP('autoMakeup', e.target.checked ? 1 : 0)}
                        className="size-2.5 rounded accent-current"
                        style={{ accentColor: topoColor }}
                    />
                    Auto Gain
                </label>
                <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                    <input
                        type="checkbox"
                        checked={patch.deltaListen}
                        onChange={(e) => setP('deltaListen', e.target.checked ? 1 : 0)}
                        className="size-2.5 rounded accent-current"
                        style={{ accentColor: topoColor }}
                    />
                    Delta
                </label>
                <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                    <input
                        type="checkbox"
                        checked={patch.gainMatchBypass}
                        onChange={(e) => setP('gainMatchBypass', e.target.checked ? 1 : 0)}
                        className="size-2.5 rounded accent-current"
                        style={{ accentColor: topoColor }}
                    />
                    Match
                </label>
            </div>

            {/* ─── Main: curve + meter | controls ─── */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

                {/* LEFT: Transfer curve + GR meter + GR history */}
                <div
                    className="flex flex-col gap-1 p-2 shrink-0"
                    style={{
                        background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                        borderRight: '1px solid rgba(40,40,40,0.3)',
                    }}
                >
                    <div className="flex gap-1">
                        <GlutenCurve
                            threshold={patch.threshold}
                            ratio={patch.ratio}
                            knee={patch.knee}
                            makeup={patch.makeup}
                            grDb={grDb}
                            inputDb={inputDb}
                            width={260}
                            height={170}
                            onThresholdChange={(v) => setP('threshold', v)}
                            accentColor={topoColor}
                        />
                        <GrMeter
                            grDb={grDb}
                            inputDb={inputDb}
                            outputDb={outputDb}
                            width={50}
                            height={170}
                            accentColor={topoColor}
                        />
                    </div>
                    <GrHistory
                        grDb={grDb}
                        width={314}
                        height={50}
                        accentColor={topoColor}
                    />
                    {/* Advanced metering info bar */}
                    <div className="flex items-center gap-3 px-1 text-[7px] text-muted-foreground/50 font-mono">
                        <span>Crest: {crest.toFixed(1)} dB</span>
                        <span>Phase: {phaseCorr > 0.99 ? 'M' : phaseCorr < -0.99 ? 'OOP' : phaseCorr.toFixed(2)}</span>
                        {latency > 0 ? <span>Lat: {latency} smp</span> : null}
                    </div>
                </div>

                {/* RIGHT: Controls */}
                <div className="flex-1 overflow-y-auto p-2 space-y-3">
                    {/* Core controls row */}
                    <div className="space-y-1">
                        <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">Compression</div>
                        <div className="flex gap-3 flex-wrap">
                            <K v={patch.threshold} k="threshold" label="Threshold" min={-60} max={0} step={0.5} def={-18} unit="dB" />
                            <K v={patch.ratio} k="ratio" label="Ratio" min={1} max={20} step={0.5} def={4} unit=":1" />
                            <K v={patch.attack} k="attack" label="Attack" min={0.02} max={250} step={0.1} def={10} unit="ms" />
                            <K v={patch.release} k="release" label="Release" min={25} max={5000} step={1} def={300} unit="ms" />
                            <K v={patch.knee} k="knee" label="Knee" min={0} max={30} step={0.5} def={6} unit="dB" />
                        </div>
                    </div>

                    {/* Output controls row */}
                    <div className="space-y-1">
                        <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">Output</div>
                        <div className="flex gap-3 items-end flex-wrap">
                            <K v={patch.makeup} k="makeup" label="Makeup" min={-12} max={24} step={0.5} def={0} unit="dB" />
                            <K v={patch.mix} k="mix" label="Mix" min={0} max={1} step={0.01} def={1} />
                            <K v={patch.range} k="range" label="Range" min={0} max={60} step={1} def={15} unit="dB" />
                            {/* Oversampling selector */}
                            <div className="flex flex-col items-center gap-0.5 pb-1">
                                <div className="flex gap-0.5">
                                    {['1x', '2x', '4x'].map((name, i) => {
                                        const rate = [1, 2, 4][i]!;
                                        return (
                                            <button key={name} type="button"
                                                className={`px-1 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                                    patch.oversampling === rate ? 'text-white' : 'text-muted-foreground/40 hover:text-foreground'
                                                }`}
                                                style={patch.oversampling === rate ? { backgroundColor: topoColor } : undefined}
                                                onClick={() => setP('oversampling', rate)}
                                            >{name}</button>
                                        );
                                    })}
                                </div>
                                <span className="text-[6px] text-muted-foreground leading-none">OS</span>
                            </div>
                        </div>
                    </div>

                    {/* Sidechain controls */}
                    <div className="space-y-1">
                        <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">Sidechain</div>
                        <div className="flex gap-3 items-end flex-wrap">
                            <K v={patch.scHpfFreq} k="scHpfFreq" label="SC HPF" min={20} max={500} step={1} def={80} unit="Hz" />
                            <K v={patch.scLpfFreq} k="scLpfFreq" label="SC LPF" min={1000} max={20000} step={100} def={20000} unit="Hz" />
                            <K v={patch.scEqFreq} k="scEqFreq" label="SC EQ" min={20} max={20000} step={10} def={1000} unit="Hz" />
                            <K v={patch.scEqGain} k="scEqGain" label="EQ Gain" min={-18} max={18} step={0.5} def={0} unit="dB" />
                            <K v={patch.scEqQ} k="scEqQ" label="EQ Q" min={0.1} max={10} step={0.1} def={1} />
                            <K v={patch.stereoLink} k="stereoLink" label="Link" min={0} max={1} step={0.01} def={1} />
                            <K v={patch.lookahead} k="lookahead" label="Look" min={0} max={20} step={0.5} def={0} unit="ms" />

                            {/* Thrust buttons */}
                            <div className="flex flex-col items-center gap-0.5">
                                <div className="flex gap-0.5">
                                    {['Off', 'Med', 'Loud'].map((name, i) => (
                                        <button key={name} type="button"
                                            className={`px-1 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                                patch.thrust === i ? 'text-white' : 'text-muted-foreground/40 hover:text-foreground'
                                            }`}
                                            style={patch.thrust === i ? { backgroundColor: topoColor } : undefined}
                                            onClick={() => setP('thrust', i)}
                                        >{name}</button>
                                    ))}
                                </div>
                                <span className="text-[6px] text-muted-foreground leading-none">Thrust</span>
                            </div>

                            {/* Detection mode */}
                            <div className="flex flex-col items-center gap-0.5">
                                <div className="flex gap-0.5">
                                    {['RMS', 'Peak'].map((name, i) => (
                                        <button key={name} type="button"
                                            className={`px-1.5 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                                (patch.detection === 'peak' ? 1 : 0) === i ? 'text-white' : 'text-muted-foreground/40 hover:text-foreground'
                                            }`}
                                            style={(patch.detection === 'peak' ? 1 : 0) === i ? { backgroundColor: topoColor } : undefined}
                                            onClick={() => setP('detection', i)}
                                        >{name}</button>
                                    ))}
                                </div>
                                <span className="text-[6px] text-muted-foreground leading-none">Detect</span>
                            </div>

                            {/* Stereo mode */}
                            <div className="flex flex-col items-center gap-0.5">
                                <div className="flex gap-0.5">
                                    {['St', 'M', 'S', 'D'].map((name, i) => (
                                        <button key={name} type="button"
                                            className={`px-1 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                                (['stereo', 'mid', 'side', 'dual-mono'].indexOf(patch.stereoMode)) === i ? 'text-white' : 'text-muted-foreground/40 hover:text-foreground'
                                            }`}
                                            style={(['stereo', 'mid', 'side', 'dual-mono'].indexOf(patch.stereoMode)) === i ? { backgroundColor: topoColor } : undefined}
                                            onClick={() => setP('stereoMode', i)}
                                            title={['Stereo', 'Mid', 'Side', 'Dual Mono'][i]}
                                        >{name}</button>
                                    ))}
                                </div>
                                <span className="text-[6px] text-muted-foreground leading-none">Stereo</span>
                            </div>
                        </div>
                    </div>

                    {/* Topology-specific controls */}
                    {patch.topology === 'fet' ? (
                        <div className="space-y-1">
                            <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">FET Character</div>
                            <div className="flex gap-3 items-end flex-wrap">
                                <K v={patch.inputGain} k="inputGain" label="Input" min={-12} max={24} step={0.5} def={0} unit="dB" />
                                <K v={patch.outputGain} k="outputGain" label="Output" min={-24} max={24} step={0.5} def={0} unit="dB" />
                                <K v={patch.xfmrDrive} k="xfmrDrive" label="Xfmr" min={0} max={3} step={0.01} def={1.2} />
                                <K v={patch.jfetK3} k="jfetK3" label="Odd" min={0} max={0.5} step={0.01} def={0.15} />
                                <K v={patch.xfmrK2} k="xfmrK2" label="Even" min={0} max={0.3} step={0.01} def={0} />
                                <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer pb-2">
                                    <input type="checkbox" checked={patch.allButtons}
                                        onChange={(e) => setP('allButtons', e.target.checked ? 1 : 0)}
                                        className="size-2.5 rounded" style={{ accentColor: topoColor }} />
                                    All Buttons
                                </label>
                            </div>
                        </div>
                    ) : null}

                    {patch.topology === 'opto' ? (
                        <div className="space-y-1">
                            <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">Opto Character</div>
                            <div className="flex gap-3 items-center">
                                {['Compress', 'Limit'].map((name, i) => (
                                    <button key={name} type="button"
                                        className={`px-2 py-0.5 rounded text-[8px] font-medium transition-colors ${
                                            (patch.limitMode ? 1 : 0) === i ? 'text-white' : 'text-muted-foreground/50 hover:text-foreground'
                                        }`}
                                        style={(patch.limitMode ? 1 : 0) === i ? { backgroundColor: topoColor } : undefined}
                                        onClick={() => setP('limitMode', i)}
                                    >{name}</button>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {patch.topology === 'diode' ? (
                        <div className="space-y-1">
                            <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">Diode Character</div>
                            <div className="flex gap-3 items-center">
                                <div className="flex flex-col items-center gap-0.5">
                                    <div className="flex gap-0.5">
                                        {[1, 2, 3, 4, 5].map((r) => (
                                            <button key={r} type="button"
                                                className={`w-5 h-5 rounded text-[8px] font-bold transition-colors ${
                                                    patch.recovery === r ? 'text-white' : 'text-muted-foreground/40 hover:text-foreground'
                                                }`}
                                                style={patch.recovery === r ? { backgroundColor: topoColor } : undefined}
                                                onClick={() => setP('recovery', r)}
                                            >{r}</button>
                                        ))}
                                    </div>
                                    <span className="text-[6px] text-muted-foreground leading-none">Recovery</span>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {patch.topology === 'vca' ? (
                        <div className="space-y-1">
                            <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">VCA Character</div>
                            <div className="flex gap-3 items-end flex-wrap">
                                {/* VCA type selector */}
                                <div className="flex flex-col items-center gap-0.5 pb-1">
                                    <div className="flex gap-0.5">
                                        {['Ideal', '2181', '202'].map((name, i) => (
                                            <button key={name} type="button"
                                                className={`px-1 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                                    patch.vcaType === i ? 'text-white' : 'text-muted-foreground/40 hover:text-foreground'
                                                }`}
                                                style={patch.vcaType === i ? { backgroundColor: topoColor } : undefined}
                                                onClick={() => setP('vcaType', i)}
                                                title={['Ideal (clean)', 'THAT 2181 (subtle)', 'DBX 202 (warm)'][i]}
                                            >{name}</button>
                                        ))}
                                    </div>
                                    <span className="text-[6px] text-muted-foreground leading-none">VCA Type</span>
                                </div>
                                <K v={patch.vcaCharacter} k="vcaCharacter" label="Color" min={0} max={0.02} step={0.001} def={0.003} />
                                <div className="flex flex-col items-center gap-0.5 pb-1">
                                    <div className="flex gap-0.5">
                                        {['FB', 'FF'].map((name, i) => (
                                            <button key={name} type="button"
                                                className={`px-1.5 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                                    (patch.feedForward ? 1 : 0) === i ? 'text-white' : 'text-muted-foreground/40 hover:text-foreground'
                                                }`}
                                                style={(patch.feedForward ? 1 : 0) === i ? { backgroundColor: topoColor } : undefined}
                                                onClick={() => setP('feedForward', i)}
                                                title={['Feedback (SSL)', 'Feed-Forward'][i]}
                                            >{name}</button>
                                        ))}
                                    </div>
                                    <span className="text-[6px] text-muted-foreground leading-none">Topology</span>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {/* Dual-stage serial routing */}
                    <div className="space-y-1">
                        <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">Dual Stage</div>
                        <div className="flex gap-3 items-end flex-wrap">
                            <K v={patch.blendAmount} k="blendAmount" label="Blend" min={0} max={1} step={0.01} def={0} />
                            <div className="flex flex-col items-center gap-0.5 pb-1">
                                <div className="flex gap-0.5">
                                    {TOPOLOGIES.filter((t) => t !== patch.topology).map((topo) => {
                                        const meta = TOPOLOGY_META[topo];
                                        const active = patch.blendTopology === topo;
                                        return (
                                            <button key={topo} type="button"
                                                className={`px-1 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                                    active ? 'text-white' : 'text-muted-foreground/40 hover:text-foreground'
                                                }`}
                                                style={active ? { backgroundColor: meta.color } : undefined}
                                                onClick={() => setP('blendTopology', TOPOLOGIES.indexOf(topo))}
                                            >{meta.label}</button>
                                        );
                                    })}
                                </div>
                                <span className="text-[6px] text-muted-foreground leading-none">2nd Stage</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

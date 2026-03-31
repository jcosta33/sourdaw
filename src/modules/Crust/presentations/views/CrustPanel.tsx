/**
 * CrustPanel — limiter/saturator plugin UI.
 *
 * Layout:
 *   Header: CRUST title | level dots | preset selector | streaming target
 *   Body:
 *     GainStrip (left 52px, vertical slider)
 *     CenterPanel:
 *       WaveformDisplay (top 160px, canvas, 60fps)
 *       ControlZone (bottom, switches per level 1–5)
 *     MeteringStrip (right 160px, LUFS + GR + TP)
 *   BottomBar: Ceiling | TP | Oversample | A=B | Reset
 */
import { type ReactElement, useSyncExternalStore } from 'react';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
    crustStore,
    type CrustState,
    setCrustUiLevel,
    loadCrustPatch,
    resetCrustMeters,
    setCrustParam,
} from '../../stores/crustStore';
import { setCrustParamWithAudio } from '../../useCases/crustParamBridge';
import { CRUST_PRESETS } from '../../useCases/crustPresets';
import { type CrustPatch } from '../../models/CrustPatch';
import { CrustGainStrip } from '../components/CrustGainStrip';
import { CrustWaveformDisplay } from '../components/CrustWaveformDisplay';
import { CrustMeteringStrip } from '../components/CrustMeteringStrip';
import { CrustControlZone } from '../components/CrustControlZone';

// ── Streaming preset table ────────────────────────────────────────────────────

const STREAMING_PRESETS = [
    { id: 'spotify',    label: 'Spotify / Apple Music', lufsTarget: -14, tpCeiling: -1.0, group: 'Streaming' },
    { id: 'youtube',    label: 'YouTube',               lufsTarget: -14, tpCeiling: -1.0, group: 'Streaming' },
    { id: 'tidal',      label: 'Tidal',                 lufsTarget: -14, tpCeiling: -1.0, group: 'Streaming' },
    { id: 'amazon',     label: 'Amazon Music',          lufsTarget: -14, tpCeiling: -2.0, group: 'Streaming' },
    { id: 'ebu_r128',   label: 'EBU R128',              lufsTarget: -23, tpCeiling: -1.0, group: 'Broadcast' },
    { id: 'atsc_a85',   label: 'ATSC A/85 (US TV)',     lufsTarget: -24, tpCeiling: -2.0, group: 'Broadcast' },
    { id: 'cd_master',  label: 'CD Master',             lufsTarget: -9,  tpCeiling: -0.1, group: 'Music Production' },
    { id: 'club_dance', label: 'Club / Dance',          lufsTarget: -8,  tpCeiling: -0.3, group: 'Music Production' },
    { id: 'hifi',       label: 'Hi-Fi Streaming',       lufsTarget: -12, tpCeiling: -1.0, group: 'Music Production' },
    { id: 'custom',     label: 'Custom…',               lufsTarget: -14, tpCeiling: -1.0, group: 'Custom' },
] as const;

type StreamingPreset = (typeof STREAMING_PRESETS)[number];

function getLufsTarget(presetId: string): number | null {
    const p = STREAMING_PRESETS.find((s) => s.id === presetId);
    return p ? p.lufsTarget : null;
}

// Group streaming presets by their group key, preserving insertion order
function groupPresets(presets: readonly StreamingPreset[]): [string, StreamingPreset[]][] {
    const map = new Map<string, StreamingPreset[]>();
    for (const p of presets) {
        const entry = map.get(p.group);
        if (entry) {
            entry.push(p);
        } else {
            map.set(p.group, [p]);
        }
    }
    return [...map.entries()];
}

const OVERSAMPLE_OPTIONS = [1, 4, 8, 16, 32] as const;

// ── CrustPanel ────────────────────────────────────────────────────────────────

export const CrustPanel = (): ReactElement => {
    const state = useSyncExternalStore<CrustState | null>(
        (cb) => crustStore.subscribe(cb),
        () => crustStore.value,
    );

    const [presetMenuOpen, setPresetMenuOpen] = useState(false);
    const [streamingMenuOpen, setStreamingMenuOpen] = useState(false);

    const patch = state?.patch ?? crustStore.value!.patch;
    const grDb = state?.grDb ?? 0;
    const inputDb = state?.inputDb ?? -60;
    const outputDb = state?.outputDb ?? -60;
    const lufsIntegrated = state?.lufsIntegrated ?? -100;
    const lufsShortTerm = state?.lufsShortTerm ?? -100;
    const lufsMomentary = state?.lufsMomentary ?? -100;
    const lra = state?.lra ?? 0;
    const truepeakMax = state?.truepeakMax ?? -100;
    const truepeakExceeded = state?.truepeakExceeded ?? false;

    const lufsTarget = getLufsTarget(patch.streamingPreset);
    const activeStreamingPreset = STREAMING_PRESETS.find((p) => p.id === patch.streamingPreset);
    const streamingLabel = activeStreamingPreset
        ? `${activeStreamingPreset.label}  ${activeStreamingPreset.lufsTarget} LUFS`
        : 'Custom';

    // Unified param setter: numeric → rAF-throttled audio bridge; other → store only
    function handleSetParam(key: keyof CrustPatch, value: number | boolean | string): void {
        if (typeof value === 'number') {
            setCrustParamWithAudio(key as never, value);
        } else {
            setCrustParam(key as never, value as never);
        }
    }

    const level = patch.uiLevel;

    return (
        <div
            className="flex flex-col h-full text-foreground select-none"
            style={{ background: '#0E0E10', fontFamily: '"Inter", sans-serif' }}
        >
            {/* ─── Header ─────────────────────────────────────────────────────── */}
            <div
                className="flex items-center gap-3 px-3 py-1.5 shrink-0"
                style={{
                    background: 'linear-gradient(180deg, rgba(22,22,25,0.98) 0%, rgba(14,14,16,0.98) 100%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 3px rgba(0,0,0,0.5)',
                    borderBottom: patch.deltaListen
                        ? '2px solid #C44030'
                        : '1px solid rgba(40,40,46,0.6)',
                }}
            >
                {/* Plugin title */}
                <span
                    className="font-semibold uppercase tracking-widest shrink-0"
                    style={{ fontSize: 11, color: '#E8E6E0', letterSpacing: '0.1em' }}
                >
                    Crust
                </span>

                {/* Complexity level dots */}
                <div className="flex gap-1 items-center" role="group" aria-label="Complexity level">
                    {([1, 2, 3, 4, 5] as const).map((l) => (
                        <button
                            key={l}
                            type="button"
                            aria-label={`Level ${l}`}
                            aria-pressed={level === l}
                            onClick={() => setCrustUiLevel(l)}
                            className="transition-all rounded-full"
                            style={{
                                width: 8,
                                height: 8,
                                background: l <= level ? '#5B8FC4' : '#2E2E36',
                                border: `1px solid ${l <= level ? '#5B8FC4' : '#2E2E36'}`,
                            }}
                        />
                    ))}
                </div>

                {/* Factory preset selector */}
                <div className="relative shrink-0">
                    <button
                        type="button"
                        className="flex items-center gap-1 bg-surface-inset border border-border/40 rounded px-2 py-0.5 text-[10px] text-foreground font-medium cursor-pointer min-w-[120px]"
                        onClick={() => setPresetMenuOpen(!presetMenuOpen)}
                        aria-haspopup="listbox"
                        aria-expanded={presetMenuOpen}
                    >
                        <span className="truncate flex-1 text-left">{patch.name}</span>
                        <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                    </button>
                    {presetMenuOpen ? (
                        <div
                            className="absolute top-full left-0 mt-1 z-50 bg-surface-raised border border-border/40 rounded-md shadow-lg py-0.5 min-w-[200px] max-h-[240px] overflow-y-auto"
                            role="listbox"
                            aria-label="Crust presets"
                        >
                            {CRUST_PRESETS.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    role="option"
                                    aria-selected={p.patch.name === patch.name}
                                    className={`w-full text-left px-2 py-1 text-[9px] hover:bg-surface-inset transition-colors ${
                                        p.patch.name === patch.name ? 'text-foreground font-medium' : 'text-foreground/70'
                                    }`}
                                    onClick={() => { loadCrustPatch(p.patch); setPresetMenuOpen(false); }}
                                >
                                    <span className="block truncate">{p.name}</span>
                                    <span className="text-[7px] text-muted-foreground/40">{p.category}</span>
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>

                {/* Streaming target selector */}
                <div className="relative shrink-0">
                    <button
                        type="button"
                        className="flex items-center gap-1 bg-surface-inset border border-border/40 rounded px-2 py-0.5 text-[9px] text-muted-foreground cursor-pointer max-w-[180px]"
                        onClick={() => setStreamingMenuOpen(!streamingMenuOpen)}
                        aria-haspopup="listbox"
                        aria-expanded={streamingMenuOpen}
                        title={streamingLabel}
                    >
                        <span className="truncate">{streamingLabel}</span>
                        <ChevronDown className="size-3 shrink-0" />
                    </button>
                    {streamingMenuOpen ? (
                        <div
                            className="absolute top-full right-0 mt-1 z-50 bg-surface-raised border border-border/40 rounded-md shadow-lg py-1 min-w-[240px] max-h-[280px] overflow-y-auto"
                            role="listbox"
                            aria-label="Streaming loudness targets"
                        >
                            {groupPresets(STREAMING_PRESETS).map(([group, presets]) => (
                                <div key={group}>
                                    <div className="px-2 pt-1 pb-0.5 text-[7px] font-semibold text-muted-foreground/40 uppercase tracking-widest">
                                        {group}
                                    </div>
                                    {presets.map((p) => (
                                        <button
                                            key={p.id}
                                            type="button"
                                            role="option"
                                            aria-selected={patch.streamingPreset === p.id}
                                            className={`w-full text-left px-2 py-1 text-[9px] hover:bg-surface-inset transition-colors flex justify-between items-baseline gap-2 ${
                                                patch.streamingPreset === p.id ? 'text-foreground' : 'text-foreground/70'
                                            }`}
                                            onClick={() => {
                                                handleSetParam('streamingPreset', p.id);
                                                if (p.id !== 'custom') {
                                                    handleSetParam('ceiling', p.tpCeiling);
                                                }
                                                setStreamingMenuOpen(false);
                                            }}
                                        >
                                            <span>{p.label}</span>
                                            {p.id !== 'custom' ? (
                                                <span className="text-[7px] text-muted-foreground/40 font-mono shrink-0">
                                                    {p.lufsTarget} LUFS · TP {p.tpCeiling}
                                                </span>
                                            ) : null}
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>

                <div className="flex-1" />
            </div>

            {/* ─── Body ───────────────────────────────────────────────────────── */}
            <div className="flex flex-1 min-h-0">
                {/* Left: vertical gain push slider */}
                <CrustGainStrip
                    value={patch.gain}
                    onChange={(v) => setCrustParamWithAudio('gain', v)}
                />

                {/* Center: waveform + controls */}
                <div className="flex flex-col flex-1 min-w-0">
                    {/* Canvas waveform/GR display */}
                    <div style={{ height: 160, flexShrink: 0 }}>
                        <CrustWaveformDisplay
                            grDb={grDb}
                            inputDb={inputDb}
                            outputDb={outputDb}
                            lufsShortTerm={lufsShortTerm}
                            lufsTarget={lufsTarget}
                            deltaListen={patch.deltaListen}
                            scrollSpeed={patch.scrollSpeed}
                        />
                    </div>

                    {/* Level-switched control zone */}
                    <div
                        className="flex-1 overflow-hidden"
                        style={{ borderTop: '1px solid rgba(46,46,54,0.4)' }}
                    >
                        <CrustControlZone
                            patch={patch}
                            setParam={handleSetParam}
                            lufsIntegrated={lufsIntegrated}
                            lufsShortTerm={lufsShortTerm}
                            lufsMomentary={lufsMomentary}
                            lra={lra}
                            truepeakMax={truepeakMax}
                            grDb={grDb}
                        />
                    </div>
                </div>

                {/* Right: metering strip */}
                <CrustMeteringStrip
                    grDb={grDb}
                    outputDb={outputDb}
                    lufsIntegrated={lufsIntegrated}
                    lufsShortTerm={lufsShortTerm}
                    lufsMomentary={lufsMomentary}
                    lra={lra}
                    truepeakMax={truepeakMax}
                    truepeakExceeded={truepeakExceeded}
                    lufsTarget={lufsTarget}
                    onResetTp={() => {
                        const s = crustStore.value;
                        if (s) {
                            crustStore.set({ ...s, truepeakMax: -100, truepeakExceeded: false });
                        }
                    }}
                />
            </div>

            {/* ─── Bottom bar ─────────────────────────────────────────────────── */}
            <div
                className="flex items-center gap-3 px-3 py-1 shrink-0 text-[9px]"
                style={{
                    background: 'linear-gradient(180deg, rgba(14,14,16,0.98) 0%, rgba(10,10,12,0.98) 100%)',
                    borderTop: '1px solid rgba(40,40,46,0.6)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
                }}
            >
                {/* Ceiling */}
                <label className="flex items-center gap-1 text-muted-foreground/60">
                    <span className="font-medium uppercase tracking-wide text-[7px]">Ceiling</span>
                    <input
                        type="number"
                        min={-6}
                        max={0}
                        step={0.1}
                        value={patch.ceiling}
                        onChange={(e) => handleSetParam('ceiling', Number(e.target.value))}
                        className="w-14 bg-surface-inset border border-border/30 rounded px-1 py-0.5 font-mono text-foreground text-center"
                        aria-label="Output ceiling in dBTP"
                    />
                    <span className="text-muted-foreground/40">{patch.truePeak ? 'dBTP' : 'dBFS'}</span>
                </label>

                <div className="w-px h-4 bg-border/20" />

                {/* True Peak toggle */}
                <button
                    type="button"
                    className="flex items-center gap-1 font-medium transition-all"
                    style={{ color: patch.truePeak ? '#4A7C6F' : '#52515A' }}
                    onClick={() => handleSetParam('truePeak', !patch.truePeak)}
                    aria-pressed={patch.truePeak}
                >
                    <span
                        className="inline-block rounded-full"
                        style={{
                            width: 6,
                            height: 6,
                            background: patch.truePeak ? '#4A7C6F' : '#2E2E36',
                        }}
                    />
                    True Peak
                </button>

                {/* Oversampling (L2+) */}
                {level >= 2 ? (
                    <>
                        <div className="w-px h-4 bg-border/20" />
                        <div className="flex items-center gap-1 text-muted-foreground/40">
                            <span className="text-[7px] uppercase tracking-wide">OS</span>
                            <div className="flex gap-0.5">
                                {OVERSAMPLE_OPTIONS.map((os) => (
                                    <button
                                        key={os}
                                        type="button"
                                        className="px-1 rounded transition-colors text-[8px] font-mono"
                                        style={
                                            patch.oversampling === os
                                                ? { background: '#5B8FC4', color: '#0E0E10' }
                                                : { color: '#52515A' }
                                        }
                                        onClick={() => handleSetParam('oversampling', os)}
                                        aria-pressed={patch.oversampling === os}
                                    >
                                        {os === 1 ? 'Off' : `${os}×`}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </>
                ) : null}

                <div className="flex-1" />

                {/* Unity Gain / A=B comparison */}
                <button
                    type="button"
                    className="px-2 py-0.5 rounded font-medium transition-all"
                    style={
                        patch.unityGain
                            ? { background: '#5B8FC4', color: '#0E0E10' }
                            : { color: '#52515A' }
                    }
                    onClick={() => handleSetParam('unityGain', !patch.unityGain)}
                    aria-pressed={patch.unityGain}
                    title="Unity gain — A/B loudness comparison"
                >
                    A=B
                </button>

                {/* Reset meter statistics */}
                <button
                    type="button"
                    className="px-2 py-0.5 rounded text-muted-foreground/40 hover:text-foreground hover:bg-surface-raised transition-all font-medium"
                    onClick={() => resetCrustMeters()}
                    title="Reset all peak holds and LUFS statistics"
                    aria-label="Reset meters"
                >
                    Reset
                </button>
            </div>
        </div>
    );
};

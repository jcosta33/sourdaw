import { type ReactElement, useState, useSyncExternalStore } from 'react';
import { ChevronDown } from 'lucide-react';
import { crustStore, type CrustState, resetCrustMeters, setCrustUiLevel } from '../../stores/crustStore';
import { loadCrustPatchWithAudio, setCrustParamWithAudio } from '../../useCases/crustParamBridge';
import { CRUST_PRESETS } from '../../useCases/crustPresets';
import { type CrustPatch } from '../../models/CrustPatch';
import { CrustGainStrip } from '../components/CrustGainStrip';
import { CrustWaveformDisplay } from '../components/CrustWaveformDisplay';
import { CrustMeteringStrip } from '../components/CrustMeteringStrip';
import { CrustControlZone } from '../components/CrustControlZone';

const STREAMING_PRESETS = [
    { id: 'spotify', label: 'Spotify / Apple Music', lufsTarget: -14, tpCeiling: -1.0, group: 'Streaming' },
    { id: 'youtube', label: 'YouTube', lufsTarget: -14, tpCeiling: -1.0, group: 'Streaming' },
    { id: 'tidal', label: 'Tidal', lufsTarget: -14, tpCeiling: -1.0, group: 'Streaming' },
    { id: 'amazon', label: 'Amazon Music', lufsTarget: -14, tpCeiling: -2.0, group: 'Streaming' },
    { id: 'ebu_r128', label: 'EBU R128', lufsTarget: -23, tpCeiling: -1.0, group: 'Broadcast' },
    { id: 'atsc_a85', label: 'ATSC A/85 (US TV)', lufsTarget: -24, tpCeiling: -2.0, group: 'Broadcast' },
    { id: 'cd_master', label: 'CD Master', lufsTarget: -9, tpCeiling: -0.1, group: 'Music' },
    { id: 'club_dance', label: 'Club / Dance', lufsTarget: -8, tpCeiling: -0.3, group: 'Music' },
    { id: 'hifi', label: 'Hi-Fi Streaming', lufsTarget: -12, tpCeiling: -1.0, group: 'Music' },
    { id: 'custom', label: 'Custom…', lufsTarget: -14, tpCeiling: -1.0, group: 'Custom' },
] as const;

type StreamingPreset = (typeof STREAMING_PRESETS)[number];

const OVERSAMPLE_OPTIONS = [1, 4, 8, 16, 32] as const;

function getLufsTarget(presetId: string): number | null {
    const preset = STREAMING_PRESETS.find((entry) => entry.id === presetId);
    if (preset) {
        return preset.lufsTarget;
    }

    return null;
}

function groupPresets(presets: readonly StreamingPreset[]): [string, StreamingPreset[]][] {
    const grouped = new Map<string, StreamingPreset[]>();
    for (const preset of presets) {
        const entry = grouped.get(preset.group);
        if (entry) {
            entry.push(preset);
        } else {
            grouped.set(preset.group, [preset]);
        }
    }

    return [...grouped.entries()];
}

const MetricTile = ({ label, value, detail }: { label: string; value: string; detail: string }): ReactElement => (
    <div className="crust-window flex min-w-[92px] flex-col gap-1 px-3 py-2">
        <span className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">{label}</span>
        <span className="font-mono text-[13px] text-foreground">{value}</span>
        <span className="text-[9px] text-muted-foreground/55">{detail}</span>
    </div>
);

export const CrustPanel = (): ReactElement => {
    const state = useSyncExternalStore<CrustState | null>(
        (cb) => crustStore.subscribe(cb),
        () => crustStore.value
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
    const activeStreamingPreset = STREAMING_PRESETS.find((preset) => preset.id === patch.streamingPreset);
    const normalizationLoss = lufsTarget !== null ? Math.max(0, lufsShortTerm - lufsTarget) : 0;
    const streamingLabel = activeStreamingPreset ? activeStreamingPreset.label : 'Custom';

    function handleSetParam<K extends keyof CrustPatch>(key: K, value: CrustPatch[K]): void {
        setCrustParamWithAudio(key, value);
    }

    return (
        <div className="crust-faceplate flex h-full min-h-0 flex-col gap-2.5 overflow-hidden p-2.5 text-foreground">
            <header className="crust-window flex shrink-0 flex-wrap items-center gap-2.5 px-3 py-2">
                <div className="space-y-1">
                    <div className="text-[8px] uppercase tracking-[0.28em] text-[var(--color-accent-peach)]/70">
                        Loudness desk
                    </div>
                    <div className="text-[13px] font-semibold text-foreground">Crust</div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                    {([1, 2, 3, 4, 5] as const).map((level) => (
                        <button
                            key={level}
                            type="button"
                            className={`crust-chip ${patch.uiLevel === level ? 'crust-chip-active' : ''}`}
                            aria-pressed={patch.uiLevel === level}
                            onClick={() => setCrustUiLevel(level)}
                        >
                            L{level}
                        </button>
                    ))}
                </div>

                <div className="relative shrink-0">
                    <button
                        type="button"
                        className="crust-window flex min-w-[164px] items-center gap-2 px-3 py-2 text-[11px]"
                        onClick={() => setPresetMenuOpen((open) => !open)}
                        aria-haspopup="listbox"
                        aria-expanded={presetMenuOpen}
                    >
                        <div className="min-w-0 flex-1 text-left">
                            <div className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/55">
                                Preset
                            </div>
                            <div className="truncate text-foreground">{patch.name}</div>
                        </div>
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/65" />
                    </button>
                    {presetMenuOpen ? (
                        <div
                            className="crust-window absolute left-0 top-full z-50 mt-1 flex max-h-[280px] min-w-[220px] flex-col overflow-y-auto p-1"
                            role="listbox"
                            aria-label="Crust presets"
                        >
                            {CRUST_PRESETS.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    role="option"
                                    aria-selected={preset.patch.name === patch.name}
                                    className={`crust-window flex w-full flex-col items-start gap-1 px-3 py-2 text-left ${
                                        preset.patch.name === patch.name ? 'border-[var(--color-accent-peach)]/35' : ''
                                    }`}
                                    onClick={() => {
                                        loadCrustPatchWithAudio(preset.patch);
                                        setPresetMenuOpen(false);
                                    }}
                                >
                                    <span className="text-[11px] font-medium text-foreground">{preset.name}</span>
                                    <span className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/50">
                                        {preset.category}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>

                <div className="relative shrink-0">
                    <button
                        type="button"
                        className="crust-window flex min-w-[196px] items-center gap-2 px-3 py-2 text-[11px]"
                        onClick={() => setStreamingMenuOpen((open) => !open)}
                        aria-haspopup="listbox"
                        aria-expanded={streamingMenuOpen}
                    >
                        <div className="min-w-0 flex-1 text-left">
                            <div className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/55">
                                Target
                            </div>
                            <div className="truncate text-foreground">{streamingLabel}</div>
                        </div>
                        <div className="text-right">
                            <div className="font-mono text-[10px] text-[var(--color-accent-peach)]">
                                {lufsTarget !== null ? `${lufsTarget} LUFS` : 'Custom'}
                            </div>
                        </div>
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/65" />
                    </button>
                    {streamingMenuOpen ? (
                        <div
                            className="crust-window absolute right-0 top-full z-50 mt-1 flex max-h-[300px] min-w-[268px] flex-col overflow-y-auto p-1"
                            role="listbox"
                            aria-label="Streaming loudness targets"
                        >
                            {groupPresets(STREAMING_PRESETS).map(([group, presets]) => (
                                <div key={group} className="mb-1 last:mb-0">
                                    <div className="px-2 pt-1 pb-1 text-[8px] uppercase tracking-[0.24em] text-muted-foreground/45">
                                        {group}
                                    </div>
                                    {presets.map((preset) => (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            role="option"
                                            aria-selected={patch.streamingPreset === preset.id}
                                            className={`crust-window flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${
                                                patch.streamingPreset === preset.id
                                                    ? 'border-[var(--color-accent-peach)]/35'
                                                    : ''
                                            }`}
                                            onClick={() => {
                                                handleSetParam('streamingPreset', preset.id);
                                                if (preset.id !== 'custom') {
                                                    handleSetParam('ceiling', preset.tpCeiling);
                                                }
                                                setStreamingMenuOpen(false);
                                            }}
                                        >
                                            <div className="min-w-0">
                                                <div className="truncate text-[11px] font-medium text-foreground">
                                                    {preset.label}
                                                </div>
                                                <div className="text-[8px] text-muted-foreground/50">
                                                    TP {preset.tpCeiling.toFixed(1)}
                                                </div>
                                            </div>
                                            <div className="font-mono text-[10px] text-[var(--color-accent-peach)]">
                                                {preset.lufsTarget} LUFS
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>

                <div className="ml-auto flex items-center gap-2">
                    <div className="crust-led">
                        {normalizationLoss > 0.25 ? `Watch ${normalizationLoss.toFixed(1)} dB` : 'On target'}
                    </div>
                    <div className="text-right">
                        <div className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/55">Ceiling</div>
                        <div className="font-mono text-[11px] text-foreground">{patch.ceiling.toFixed(1)} dBTP</div>
                    </div>
                </div>
            </header>

            <div className="flex min-h-0 flex-1 gap-2.5">
                <CrustGainStrip value={patch.gain} onChange={(value) => handleSetParam('gain', value)} />

                <div className="flex min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
                    <div className="grid shrink-0 grid-cols-4 gap-2.5">
                        <MetricTile label="Push" value={`${patch.gain.toFixed(1)} dB`} detail="Input shove" />
                        <MetricTile
                            label="Shave"
                            value={`${Math.abs(grDb).toFixed(1)} dB`}
                            detail={Math.abs(grDb) > 4 ? 'Transient flattening is obvious' : 'Still holding shape'}
                        />
                        <MetricTile
                            label="Target"
                            value={lufsTarget !== null ? `${lufsTarget} LUFS` : 'Custom'}
                            detail={streamingLabel}
                        />
                        <MetricTile
                            label="Penalty"
                            value={`${normalizationLoss.toFixed(1)} dB`}
                            detail={normalizationLoss > 0.25 ? 'Likely normalization loss' : 'Little to no turn-down'}
                        />
                    </div>

                    <div className="crust-window flex min-h-0 flex-1 flex-col gap-3 p-2.5">
                        <div className="flex items-center justify-between gap-3 px-1">
                            <div>
                                <div className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">
                                    Mission control
                                </div>
                                <div className="text-[12px] font-medium text-foreground">
                                    Waveform, loudness, and shaved peaks
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                                <span>ST {lufsShortTerm.toFixed(1)} LUFS</span>
                                <span>TP {truepeakMax.toFixed(1)} dB</span>
                            </div>
                        </div>
                        <div className="min-h-0 overflow-hidden rounded-[14px] border border-white/6">
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
                    </div>

                    <div className="crust-window min-h-0 overflow-y-auto">
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

                <div className="crust-window shrink-0 overflow-hidden">
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
                            const currentState = crustStore.value;
                            if (currentState) {
                                crustStore.set({ ...currentState, truepeakMax: -100, truepeakExceeded: false });
                            }
                        }}
                    />
                </div>
            </div>

            <footer className="crust-window flex shrink-0 flex-wrap items-center gap-2.5 px-3 py-2">
                <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="uppercase tracking-[0.22em] text-muted-foreground/55">Ceiling</span>
                    <input
                        type="number"
                        min={-6}
                        max={0}
                        step={0.1}
                        value={patch.ceiling}
                        onChange={(event) => handleSetParam('ceiling', Number(event.target.value))}
                        className="crust-window w-16 px-2 py-1 text-center font-mono text-foreground outline-none"
                        aria-label="Output ceiling in dBTP"
                    />
                </label>

                <button
                    type="button"
                    className={`crust-chip ${patch.truePeak ? 'crust-chip-active' : ''}`}
                    aria-pressed={patch.truePeak}
                    onClick={() => handleSetParam('truePeak', !patch.truePeak)}
                >
                    True peak
                </button>

                {patch.uiLevel >= 2 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {OVERSAMPLE_OPTIONS.map((option) => (
                            <button
                                key={option}
                                type="button"
                                className={`crust-chip ${patch.oversampling === option ? 'crust-chip-active' : ''}`}
                                aria-pressed={patch.oversampling === option}
                                onClick={() => handleSetParam('oversampling', option)}
                            >
                                {option === 1 ? 'OS off' : `${option}×`}
                            </button>
                        ))}
                    </div>
                ) : null}

                <div className="ml-auto flex flex-wrap gap-1.5">
                    <button
                        type="button"
                        className={`crust-chip ${patch.unityGain ? 'crust-chip-active' : ''}`}
                        aria-pressed={patch.unityGain}
                        onClick={() => handleSetParam('unityGain', !patch.unityGain)}
                    >
                        A=B
                    </button>
                    <button
                        type="button"
                        className={`crust-chip ${patch.deltaListen ? 'crust-chip-active' : ''}`}
                        aria-pressed={patch.deltaListen}
                        onClick={() => handleSetParam('deltaListen', !patch.deltaListen)}
                    >
                        Delta
                    </button>
                    <button type="button" className="crust-chip" onClick={() => resetCrustMeters()}>
                        Reset
                    </button>
                </div>
            </footer>
        </div>
    );
};

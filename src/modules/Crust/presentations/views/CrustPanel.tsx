import { type ReactElement, useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawMenuSectionLabel, DawMenuSeparator } from '#/components/daw/DawMenuParts';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginChoiceRow } from '#/components/daw/DawPluginChoiceRow';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { Row, Stack } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';

import { CRUST_OVERSAMPLE_FACTORS, type CrustPatch, type CrustStreamingPreset } from '../../models/CrustPatch';
import { crustStore, defaultCrustState } from '../../stores/crustStore';
import { loadCrustPatchWithAudio } from '../../useCases/crustParamBridge/loadCrustPatchWithAudio';
import { setCrustParamWithAudio } from '../../useCases/crustParamBridge/setCrustParamWithAudio';
import { CRUST_PRESETS } from '../../useCases/crustPresets';
import { resetCrustPanelMeters } from '../../useCases/resetCrustPanelMeters';
import { resetCrustTruePeakIndicator } from '../../useCases/resetCrustTruePeakIndicator';
import { setCrustPanelUiLevel } from '../../useCases/setCrustPanelUiLevel';
import { CrustControlZone } from '../components/CrustControlZone';
import { CrustGainStrip } from '../components/CrustGainStrip';
import { CrustMeteringStrip } from '../components/CrustMeteringStrip';
import { CrustWaveformDisplay } from '../components/CrustWaveformDisplay';

// `satisfies` ties every row's `id` to the model's CrustStreamingPreset union at
// compile time while preserving the literal `as const` types the menu relies on.
// Adding a preset to the union without a row here (or vice versa) is a type error,
// so the two definitions of the streaming-preset set can no longer drift.
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
] as const satisfies readonly {
    id: CrustStreamingPreset;
    label: string;
    lufsTarget: number;
    tpCeiling: number;
    group: string;
}[];

type StreamingPreset = (typeof STREAMING_PRESETS)[number];

// Exhaustiveness in the other direction: a union member with no row here makes
// `missingPreset` resolve to the missing literal instead of `never`, a type
// error — so the union and the data table stay in lockstep both ways.
type MissingStreamingPreset = Exclude<CrustStreamingPreset, StreamingPreset['id']>;
const _assertAllPresetsPresent: MissingStreamingPreset extends never ? true : never = true;
void _assertAllPresetsPresent;

function getLufsTarget(presetId: string): number | null {
    // 'custom' has no fixed loudness goal: the panel skips its ceiling write and
    // labels it "Custom", so the target tile, penalty math, and waveform target
    // line must also treat it as "no target" (null) rather than the −14 LUFS the
    // menu lists only as a starting suggestion.
    if (presetId === 'custom') {
        return null;
    }

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
    <DawPluginMetricTile className="crust-window min-w-[92px]" label={label} value={value} detail={detail} />
);

export const CrustPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    // §209.1 — Use a typed default instead of the live store value. A
    // store whose value is null at mount no longer crashes the panel.
    const state = useStore(crustStore, defaultCrustState);
    const [presetMenuOpen, setPresetMenuOpen] = useState(false);
    const [streamingMenuOpen, setStreamingMenuOpen] = useState(false);

    const patch = state.patch;
    const grDb = state.grDb;
    const inputDb = state.inputDb;
    const outputDb = state.outputDb;
    const lufsIntegrated = state.lufsIntegrated;
    const lufsShortTerm = state.lufsShortTerm;
    const lufsMomentary = state.lufsMomentary;
    const lra = state.lra;
    const truepeakMax = state.truepeakMax;
    const truepeakExceeded = state.truepeakExceeded;

    const lufsTarget = getLufsTarget(patch.streamingPreset);
    const activeStreamingPreset = STREAMING_PRESETS.find((preset) => preset.id === patch.streamingPreset);
    const normalizationLoss = lufsTarget !== null ? Math.max(0, lufsShortTerm - lufsTarget) : 0;
    const streamingLabel = activeStreamingPreset ? activeStreamingPreset.label : 'Custom';

    function handleSetParam<TKey extends keyof CrustPatch>(key: TKey, value: CrustPatch[TKey]): void {
        setCrustParamWithAudio(deviceId, key, value);
    }

    return (
        <Stack gap={2.5} className="crust-faceplate h-full overflow-hidden p-2.5 text-foreground">
            <Row as="header" wrap gap={2.5} shrink={false} className="crust-window px-3 py-2">
                <Stack gap={1}>
                    <div className="text-[8px] uppercase tracking-[0.28em] text-[var(--color-accent-copper)]/70">
                        Loudness desk
                    </div>
                    <div className="text-[13px] font-semibold text-foreground">Crust</div>
                </Stack>

                <Row align="stretch" wrap gap={1.5}>
                    {([1, 2, 3, 4, 5] as const).map((level) => (
                        <DawPluginChip
                            key={level}
                            active={patch.uiLevel === level}
                            tone="copper"
                            size="sm"
                            onClick={() => setCrustPanelUiLevel(level)}
                        >
                            L{level}
                        </DawPluginChip>
                    ))}
                </Row>

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
                        <Stack
                            className="crust-window daw-floating-surface absolute left-0 top-full z-50 mt-1 max-h-[280px] min-w-[220px] overflow-y-auto p-1"
                            role="listbox"
                            aria-label="Crust presets"
                        >
                            <DawMenuSectionLabel className="px-2 py-1 text-[8px] tracking-[0.24em]">
                                Factory
                            </DawMenuSectionLabel>
                            {CRUST_PRESETS.map((preset) => (
                                <DawPluginChoiceRow
                                    key={preset.id}
                                    title={preset.name}
                                    subtitle={preset.category}
                                    active={preset.patch.name === patch.name}
                                    className="crust-window w-full rounded-[12px]"
                                    onPress={() => {
                                        loadCrustPatchWithAudio(deviceId, preset.patch);
                                        setPresetMenuOpen(false);
                                    }}
                                    role="option"
                                    aria-selected={preset.patch.name === patch.name}
                                />
                            ))}
                        </Stack>
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
                            <div className="font-mono text-[10px] text-[var(--color-accent-copper)]">
                                {lufsTarget !== null ? `${lufsTarget} LUFS` : 'Custom'}
                            </div>
                        </div>
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/65" />
                    </button>
                    {streamingMenuOpen ? (
                        <Stack
                            className="crust-window daw-floating-surface absolute right-0 top-full z-50 mt-1 max-h-[300px] min-w-[268px] overflow-y-auto p-1"
                            role="listbox"
                            aria-label="Streaming loudness targets"
                        >
                            {groupPresets(STREAMING_PRESETS).map(([group, presets], groupIndex) => (
                                <div key={group} className="mb-1 last:mb-0">
                                    {groupIndex > 0 ? (
                                        <DawMenuSeparator className="mx-1 my-1 border-border/50" />
                                    ) : null}
                                    <DawMenuSectionLabel className="px-2 py-1 text-[8px] tracking-[0.24em]">
                                        {group}
                                    </DawMenuSectionLabel>
                                    {presets.map((preset) => (
                                        <DawPluginChoiceRow
                                            key={preset.id}
                                            title={preset.label}
                                            subtitle={`TP ${preset.tpCeiling.toFixed(1)}`}
                                            detail={`${preset.lufsTarget} LUFS`}
                                            active={patch.streamingPreset === preset.id}
                                            className="crust-window w-full rounded-[12px]"
                                            onPress={() => {
                                                handleSetParam('streamingPreset', preset.id);
                                                if (preset.id !== 'custom') {
                                                    handleSetParam('ceiling', preset.tpCeiling);
                                                }
                                                setStreamingMenuOpen(false);
                                            }}
                                            role="option"
                                            aria-selected={patch.streamingPreset === preset.id}
                                        />
                                    ))}
                                </div>
                            ))}
                        </Stack>
                    ) : null}
                </div>

                <Row gap={2} className="ml-auto">
                    <DawPluginLed tone="copper">
                        {normalizationLoss > 0.25 ? `Watch ${normalizationLoss.toFixed(1)} dB` : 'On target'}
                    </DawPluginLed>
                    <div className="text-right">
                        <div className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/55">Ceiling</div>
                        <div className="font-mono text-[11px] text-foreground">{patch.ceiling.toFixed(1)} dBTP</div>
                    </div>
                </Row>
            </Row>

            <Row align="stretch" grow gap={2.5} className="min-h-0">
                <CrustGainStrip value={patch.gain} onChange={(value) => handleSetParam('gain', value)} />

                <Stack grow gap={2.5} className="min-w-0 overflow-y-auto pr-1">
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

                    <Stack grow gap={3} className="crust-window p-2.5">
                        <DawPluginSectionHeader
                            className="px-1"
                            size="xs"
                            title="Mission control"
                            titleClassName="text-muted-foreground/70"
                            actions={
                                <Row gap={2} className="text-[9px] text-muted-foreground">
                                    <Stack gap={0.5}>
                                        <DawReadoutRow
                                            label="ST"
                                            value={`${lufsShortTerm.toFixed(1)} LUFS`}
                                            className="gap-1.5"
                                            labelClassName="text-[8px] text-muted-foreground/55"
                                            valueClassName="text-[8px] text-muted-foreground"
                                        />
                                        <DawReadoutRow
                                            label="TP"
                                            value={`${truepeakMax.toFixed(1)} dB`}
                                            className="gap-1.5"
                                            labelClassName="text-[8px] text-muted-foreground/55"
                                            valueClassName="text-[8px] text-muted-foreground"
                                        />
                                    </Stack>
                                </Row>
                            }
                        />
                        <div className="px-1 text-[12px] font-medium text-foreground">
                            Waveform, loudness, and shaved peaks
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
                    </Stack>

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
                </Stack>

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
                        onResetTp={() => resetCrustTruePeakIndicator(deviceId)}
                    />
                </div>
            </Row>

            {/* A plain <div>, not <footer>: this is a control strip inside a device
                panel, not page footer content. As a <footer> whose ancestors are all
                <div> it mapped to a second `contentinfo` landmark alongside the app
                status bar, which is invalid and makes landmark navigation ambiguous. */}
            <Row wrap gap={2.5} shrink={false} className="crust-window px-3 py-2">
                <Row as="label" gap={2} className="text-[10px] text-muted-foreground">
                    <span className="uppercase tracking-[0.22em] text-muted-foreground/55">Ceiling</span>
                    <DawCompactInput
                        type="number"
                        min={-6}
                        max={0}
                        step={0.1}
                        value={patch.ceiling}
                        onChange={(event) => handleSetParam('ceiling', Number(event.target.value))}
                        className="crust-window w-16"
                        align="center"
                        monospace
                        aria-label="Output ceiling in dBTP"
                    />
                </Row>

                <DawPluginChip
                    active={patch.truePeak}
                    tone="copper"
                    size="sm"
                    onClick={() => handleSetParam('truePeak', !patch.truePeak)}
                >
                    True peak
                </DawPluginChip>

                {patch.uiLevel >= 2 ? (
                    <Row align="stretch" wrap gap={1.5}>
                        {CRUST_OVERSAMPLE_FACTORS.map((option) => (
                            <DawPluginChip
                                key={option}
                                active={patch.oversampling === option}
                                tone="copper"
                                size="sm"
                                onClick={() => handleSetParam('oversampling', option)}
                            >
                                {option === 1 ? 'OS off' : `${option}×`}
                            </DawPluginChip>
                        ))}
                    </Row>
                ) : null}

                <Row align="stretch" wrap gap={1.5} className="ml-auto">
                    <DawPluginChip
                        active={patch.unityGain}
                        tone="copper"
                        size="sm"
                        onClick={() => handleSetParam('unityGain', !patch.unityGain)}
                    >
                        A=B
                    </DawPluginChip>
                    <DawPluginChip
                        active={patch.deltaListen}
                        tone="copper"
                        size="sm"
                        onClick={() => handleSetParam('deltaListen', !patch.deltaListen)}
                    >
                        Delta
                    </DawPluginChip>
                    <DawPluginChip type="button" tone="copper" size="sm" onClick={() => resetCrustPanelMeters()}>
                        Reset
                    </DawPluginChip>
                </Row>
            </Row>
        </Stack>
    );
};

/**
 * CrustControlZone — switches content based on complexity level (1–5).
 *
 * Level 1: 3-tile style selector (TRANSPARENT / PUNCHY / LOUD)
 * Level 2: Full 8-algorithm pills + Lookahead/Attack/Release knobs + CH Link sliders
 * Level 3: L2 + Saturation sub-panel (5 algorithms, curve, drive/mix) + Delta/A=B
 * Level 4: L3 + Multi-band selector + SC HPF + Stereo mode + Dithering
 * Level 5: L4 + Loudness statistics panel
 */
import { type ReactElement } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { cn } from '#/utils/Styles/cn';

import { type CrustDither, type CrustPatch } from '../../models/CrustPatch';

import { CrustSatCurve } from './CrustSatCurve';

type Setter = <TKey extends keyof CrustPatch>(key: TKey, value: CrustPatch[TKey]) => void;

type Props = {
    patch: CrustPatch;
    setParam: Setter;
    lufsIntegrated: number;
    lufsShortTerm: number;
    lufsMomentary: number;
    lra: number;
    truepeakMax: number;
    grDb: number;
};

// ── Shared primitives ─────────────────────────────────────────────────────────

const SectionLabel = ({ children }: { children: string }): ReactElement => (
    <div className="text-[7px] font-semibold text-muted-foreground/40 uppercase tracking-widest mb-1.5">{children}</div>
);

function fmtKnob(v: number, unit?: string): string {
    if (unit === 'ms') {
        return v === 0 ? 'Auto' : `${v.toFixed(0)}ms`;
    }
    if (unit === 'dB') {
        return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
    }
    if (unit === 'Hz') {
        return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`;
    }
    if (unit === '%') {
        return `${Math.round(v)}%`;
    }
    return v.toFixed(1);
}

const Knob = ({
    value,
    onChange,
    label,
    min,
    max,
    step,
    unit,
    def,
    disabled = false,
}: {
    value: number;
    onChange: (v: number) => void;
    label: string;
    min: number;
    max: number;
    step: number;
    unit?: string;
    def: number;
    disabled?: boolean;
}): ReactElement => (
    <div
        className={cn('flex flex-col items-center gap-0.5', disabled ? 'pointer-events-none opacity-40' : null)}
        aria-disabled={disabled}
    >
        <RotaryKnob
            value={value}
            onChange={disabled ? () => {} : onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={def}
            size="sm"
            tone="copper"
        />
        <span className="text-[7px] text-muted-foreground/60 leading-none">{label}</span>
        {unit !== undefined ? (
            <span className="text-[6px] font-mono text-muted-foreground/40">{fmtKnob(value, unit)}</span>
        ) : null}
    </div>
);

// A timing knob (Attack/Release) paired with its own Auto toggle. The knob and
// the toggle write independent fields, so `auto=false` with a literal 0 ms is a
// reachable state — dialing 0 no longer forces auto, and auto no longer hides
// the manual value.
const AutoKnob = ({
    auto,
    onAutoChange,
    value,
    onChange,
    label,
    min,
    max,
    step,
    def,
    toggleId,
}: {
    auto: boolean;
    onAutoChange: (auto: boolean) => void;
    value: number;
    onChange: (v: number) => void;
    label: string;
    min: number;
    max: number;
    step: number;
    def: number;
    toggleId: string;
}): ReactElement => (
    <Stack align="center" gap={0.5}>
        <RotaryKnob
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={def}
            size="sm"
            tone="copper"
        />
        <span className="text-[7px] text-muted-foreground/60 leading-none">{label}</span>
        <span className="text-[6px] font-mono text-muted-foreground/40">{auto ? 'Auto' : `${value.toFixed(0)}ms`}</span>
        <DawPluginToggle
            id={toggleId}
            pressed={auto}
            tone="steel"
            size="xs"
            onLabel="AUTO"
            offLabel="AUTO"
            role="switch"
            aria-checked={auto}
            aria-label={`${label} auto`}
            onClick={() => onAutoChange(!auto)}
        />
    </Stack>
);

const SliderRow = ({
    label,
    value,
    onChange,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
}): ReactElement => (
    <Row gap={2}>
        <span className="w-14 shrink-0 text-[7px] text-muted-foreground/40">{label}</span>
        <Slider
            value={[value]}
            min={0}
            max={100}
            step={1}
            className="flex-1"
            aria-label={label}
            onValueChange={(values) => {
                const nextValue = values[0];
                if (nextValue !== undefined) {
                    onChange(nextValue);
                }
            }}
        />
        <span className="w-8 shrink-0 text-right text-[7px] font-mono text-muted-foreground/50">{value}%</span>
    </Row>
);

// ── Algorithm data ────────────────────────────────────────────────────────────

const ALGORITHMS = [
    { id: 'transparent', label: 'Transparent', desc: 'Clean ceiling, no color' },
    { id: 'punchy', label: 'Punchy', desc: 'Snap & edge, rhythm' },
    { id: 'dynamic', label: 'Dynamic', desc: 'Enhances transients' },
    { id: 'allround', label: 'Allround', desc: 'Balanced loudness' },
    { id: 'aggressive', label: 'Aggressive', desc: 'Pushes hard' },
    { id: 'bus', label: 'Bus', desc: 'Glue and pump' },
    { id: 'safe', label: 'Safe', desc: 'Zero distortion' },
    { id: 'wall', label: 'Wall', desc: 'Max ceiling' },
] as const;

const SAT_ALGORITHMS = ['soft', 'hard', 'tape', 'tube', 'fold'] as const;

const DITHER_OPTIONS: readonly { id: CrustDither; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'tpdf16', label: 'TPDF 16-bit' },
    { id: 'tpdf24', label: 'TPDF 24-bit' },
    { id: 'powr1', label: 'POW-R 1' },
    { id: 'powr2', label: 'POW-R 2' },
    { id: 'powr3', label: 'POW-R 3' },
];

const isCrustDither = (value: string): value is CrustDither => DITHER_OPTIONS.some((option) => option.id === value);

// ── Level sub-panels ──────────────────────────────────────────────────────────

const STYLE_TILES = [
    { id: 'transparent' as const, label: 'TRANSPARENT', sub: 'Preserves dynamics\nfor any mix' },
    { id: 'punchy' as const, label: 'PUNCHY', sub: 'Snap & punch\nfor rhythmic mixes' },
    { id: 'loud' as const, label: 'LOUD', sub: 'Maximum\nloudness' },
];

const LevelTile = ({
    active,
    label,
    subtitle,
    onClick,
}: {
    active: boolean;
    label: string;
    subtitle: string;
    onClick: () => void;
}): ReactElement => (
    <Button
        variant="bare"
        size="bare"
        type="button"
        className={cn(
            'flex h-full flex-1 flex-col items-center justify-center rounded-[14px] border px-3 py-4 transition-all',
            active
                ? 'border-[var(--color-accent-cyan)]/45 border-l-[3px] bg-white/[0.045] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                : 'border-white/8 bg-black/20 text-white/36 hover:border-white/14 hover:text-white/80'
        )}
        onClick={onClick}
        aria-pressed={active}
    >
        <span className="text-[11px] font-semibold leading-tight">{label}</span>
        <span className="mt-1 whitespace-pre-line text-center text-[8px] leading-snug text-muted-foreground/45">
            {subtitle}
        </span>
    </Button>
);

const Level1 = ({ patch, setParam }: { patch: CrustPatch; setParam: Setter }): ReactElement => (
    <Row gap={2} className="h-full px-2">
        {STYLE_TILES.map((tile) => {
            const active = patch.style === tile.id;
            return (
                <LevelTile
                    key={tile.id}
                    active={active}
                    label={tile.label}
                    subtitle={tile.sub}
                    onClick={() => setParam('style', tile.id)}
                />
            );
        })}
    </Row>
);

const Level2Core = ({ patch, setParam }: { patch: CrustPatch; setParam: Setter }): ReactElement => (
    <Stack gap={2}>
        {/* Algorithm pills */}
        <div>
            <SectionLabel>Algorithm</SectionLabel>
            <Row align="stretch" wrap gap={1}>
                {ALGORITHMS.map((a) => (
                    <DawPluginChip
                        key={a.id}
                        active={patch.algorithm === a.id}
                        tone="steel"
                        size="xs"
                        onClick={() => setParam('algorithm', a.id)}
                    >
                        {a.label}
                    </DawPluginChip>
                ))}
            </Row>
            <div className="text-[7px] text-muted-foreground/40 mt-0.5 min-h-[10px]">
                {ALGORITHMS.find((a) => a.id === patch.algorithm)?.desc ?? ''}
            </div>
        </div>

        {/* Timing knobs */}
        <Row align="end" gap={3}>
            <Knob
                value={patch.lookahead}
                onChange={(v) => setParam('lookahead', v)}
                label="Lookahead"
                min={0}
                max={10}
                step={0.1}
                unit="ms"
                def={2}
            />
            <AutoKnob
                auto={patch.attackAuto}
                onAutoChange={(auto) => setParam('attackAuto', auto)}
                value={patch.attack}
                onChange={(v) => setParam('attack', v)}
                label="Attack"
                min={0}
                max={100}
                step={0.5}
                def={0}
                toggleId="crust-attack-auto"
            />
            <AutoKnob
                auto={patch.releaseAuto}
                onAutoChange={(auto) => setParam('releaseAuto', auto)}
                value={patch.release}
                onChange={(v) => setParam('release', v)}
                label="Release"
                min={0}
                max={1000}
                step={5}
                def={0}
                toggleId="crust-release-auto"
            />
        </Row>

        {/* Channel link sliders */}
        <Stack gap={1}>
            <SliderRow
                label="Link Trans"
                value={patch.channelLinkTransient}
                onChange={(value) => setParam('channelLinkTransient', value)}
            />
            <SliderRow
                label="Link Rel"
                value={patch.channelLinkRelease}
                onChange={(value) => setParam('channelLinkRelease', value)}
            />
        </Stack>
    </Stack>
);

const SatSection = ({ patch, setParam }: { patch: CrustPatch; setParam: Setter }): ReactElement => (
    <DawPluginSectionCard
        title="Saturation"
        detailMode="badge"
        detail={
            <DawPluginToggle
                id="crust-sat-enabled"
                pressed={patch.satEnabled}
                tone="amber"
                size="xs"
                role="switch"
                aria-checked={patch.satEnabled}
                onClick={() => setParam('satEnabled', !patch.satEnabled)}
            />
        }
        className="rounded-[14px] border border-white/8 bg-[linear-gradient(180deg,rgba(212,136,58,0.12),rgba(0,0,0,0.18))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        titleClassName="text-[var(--color-accent-copper)]"
    >
        <Row gap={2}>
            <Row align="stretch" wrap gap={0.5}>
                {SAT_ALGORITHMS.map((a) => (
                    <DawPluginChip
                        key={a}
                        active={patch.satAlgorithm === a}
                        tone="amber"
                        size="xs"
                        onClick={() => setParam('satAlgorithm', a)}
                        disabled={!patch.satEnabled}
                        aria-pressed={patch.satAlgorithm === a}
                    >
                        {a}
                    </DawPluginChip>
                ))}
            </Row>

            <div
                className={cn(patch.satEnabled ? null : 'pointer-events-none opacity-40')}
                aria-hidden={!patch.satEnabled}
            >
                <CrustSatCurve algorithm={patch.satAlgorithm} drive={patch.satDrive} />
            </div>

            <Row align="stretch" gap={2}>
                <Stack align="center" gap={0.5}>
                    <Knob
                        value={patch.satDrive}
                        onChange={(v) => setParam('satDrive', v)}
                        label="Drive"
                        min={0}
                        max={18}
                        step={0.1}
                        unit="dB"
                        def={0}
                        disabled={!patch.satEnabled}
                    />
                    {patch.satEnabled && patch.satDrive > 6 ? (
                        <span className="text-[6px] font-bold text-[var(--color-state-danger)]">HOT</span>
                    ) : null}
                </Stack>
                <Knob
                    value={patch.satMix}
                    onChange={(v) => setParam('satMix', v)}
                    label="Mix"
                    min={0}
                    max={100}
                    step={1}
                    unit="%"
                    def={0}
                    disabled={!patch.satEnabled}
                />
            </Row>
        </Row>
    </DawPluginSectionCard>
);

const Level3Extra = ({ patch, setParam }: { patch: CrustPatch; setParam: Setter }): ReactElement => (
    <Row gap={2} className="mt-1">
        <DawPluginToggle
            id="crust-delta"
            pressed={patch.deltaListen}
            tone="steel"
            size="xs"
            onLabel="DELTA"
            offLabel="DELTA"
            role="switch"
            aria-checked={patch.deltaListen}
            onClick={() => setParam('deltaListen', !patch.deltaListen)}
        />
        <DawPluginToggle
            id="crust-unity"
            pressed={patch.unityGain}
            tone="steel"
            size="xs"
            onLabel="A=B"
            offLabel="A=B"
            role="switch"
            aria-checked={patch.unityGain}
            onClick={() => setParam('unityGain', !patch.unityGain)}
        />
    </Row>
);

const Level4Extra = ({ patch, setParam }: { patch: CrustPatch; setParam: Setter }): ReactElement => (
    <Stack gap={2} className="mt-1 pt-1 border-t border-border/10">
        <Row align="stretch" wrap gap={3}>
            {/* Multi-band mode */}
            <div>
                <SectionLabel>Multi-band</SectionLabel>
                <Row align="stretch" gap={0.5}>
                    {(['wideband', '3band', '5band'] as const).map((mb) => (
                        <DawPluginChip
                            key={mb}
                            active={patch.multiBand === mb}
                            tone="steel"
                            size="xs"
                            onClick={() => setParam('multiBand', mb)}
                        >
                            {mb === 'wideband' ? 'Wide' : mb}
                        </DawPluginChip>
                    ))}
                </Row>
            </div>

            {/* Stereo mode */}
            <div>
                <SectionLabel>Stereo</SectionLabel>
                <Row align="stretch" gap={0.5}>
                    {(['stereo', 'ms'] as const).map((sm) => (
                        <DawPluginChip
                            key={sm}
                            active={patch.stereoMode === sm}
                            tone="steel"
                            size="xs"
                            onClick={() => setParam('stereoMode', sm)}
                        >
                            {sm.toUpperCase()}
                        </DawPluginChip>
                    ))}
                </Row>
            </div>

            {/* Sidechain HPF */}
            <div>
                <SectionLabel>SC HPF</SectionLabel>
                <Row gap={1}>
                    <DawPluginToggle
                        id="crust-sc-hpf"
                        pressed={patch.scHpfEnabled}
                        tone="steel"
                        size="xs"
                        role="switch"
                        aria-checked={patch.scHpfEnabled}
                        onClick={() => setParam('scHpfEnabled', !patch.scHpfEnabled)}
                    />
                    {patch.scHpfEnabled ? (
                        <Knob
                            value={patch.scHpfFreq}
                            onChange={(v) => setParam('scHpfFreq', v)}
                            label="HPF"
                            min={20}
                            max={200}
                            step={1}
                            unit="Hz"
                            def={60}
                        />
                    ) : null}
                </Row>
            </div>
        </Row>

        {/* Dithering */}
        <div>
            <SectionLabel>Dithering</SectionLabel>
            <DawCompactSelect
                value={patch.dither}
                onChange={(e) => {
                    if (isCrustDither(e.target.value)) {
                        setParam('dither', e.target.value);
                    }
                }}
                size="micro"
                tone="inset"
                className="min-w-[7rem]"
                aria-label="Dither mode"
            >
                {DITHER_OPTIONS.map((d) => (
                    <option key={d.id} value={d.id}>
                        {d.label}
                    </option>
                ))}
            </DawCompactSelect>
            {patch.dither !== 'off' ? (
                <Row align="stretch" gap={1} className="mt-1">
                    {([16, 24, 32] as const).map((bd) => (
                        <DawPluginChip
                            key={bd}
                            active={patch.outputBitDepth === bd}
                            tone="steel"
                            size="xs"
                            onClick={() => setParam('outputBitDepth', bd)}
                        >
                            {bd}-bit
                        </DawPluginChip>
                    ))}
                </Row>
            ) : null}
        </div>
    </Stack>
);

const Level5Stats = ({
    lufsIntegrated,
    lufsShortTerm,
    lufsMomentary,
    lra,
    truepeakMax,
    grDb,
}: {
    lufsIntegrated: number;
    lufsShortTerm: number;
    lufsMomentary: number;
    lra: number;
    truepeakMax: number;
    grDb: number;
}): ReactElement => {
    const rows: [string, string][] = [
        ['Integrated', `${lufsIntegrated.toFixed(1)} LUFS`],
        ['ST Max', `${lufsShortTerm.toFixed(1)} LUFS`],
        ['MOM Max', `${lufsMomentary.toFixed(1)} LUFS`],
        ['LRA', `${lra.toFixed(1)} LU`],
        ['TP Max', `${truepeakMax.toFixed(1)} dBTP`],
        ['GR Max', `${grDb.toFixed(1)} dB`],
    ];
    return (
        <Grid
            cols={2}
            gapX={3}
            gapY={0.5}
            className="mt-1 pt-1 border-t border-border/10"
            aria-label="Loudness statistics"
            role="group"
        >
            {rows.map(([label, value]) => (
                <DawReadoutRow
                    key={label}
                    label={label}
                    value={value}
                    className="gap-2"
                    labelClassName="text-[7px] text-muted-foreground/40"
                    valueClassName="text-[8px] text-foreground/70"
                />
            ))}
        </Grid>
    );
};

// ── Main CrustControlZone ─────────────────────────────────────────────────────

export const CrustControlZone = ({
    patch,
    setParam,
    lufsIntegrated,
    lufsShortTerm,
    lufsMomentary,
    lra,
    truepeakMax,
    grDb,
}: Props): ReactElement => {
    const level = patch.uiLevel;

    if (level === 1) {
        return (
            <div className="h-full animate-in fade-in duration-150">
                <Level1 patch={patch} setParam={setParam} />
            </div>
        );
    }

    return (
        <Stack
            gap={2}
            className="px-2 py-1.5 overflow-y-auto animate-in fade-in duration-150"
            style={{ maxHeight: '100%' }}
        >
            <Level2Core patch={patch} setParam={setParam} />

            {level >= 3 ? (
                <>
                    <SatSection patch={patch} setParam={setParam} />
                    <Level3Extra patch={patch} setParam={setParam} />
                </>
            ) : null}

            {level >= 4 ? <Level4Extra patch={patch} setParam={setParam} /> : null}

            {level >= 5 ? (
                <Level5Stats
                    lufsIntegrated={lufsIntegrated}
                    lufsShortTerm={lufsShortTerm}
                    lufsMomentary={lufsMomentary}
                    lra={lra}
                    truepeakMax={truepeakMax}
                    grDb={grDb}
                />
            ) : null}
        </Stack>
    );
};

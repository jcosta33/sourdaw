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
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type CrustPatch } from '../../models/CrustPatch';
import { CrustSatCurve } from './CrustSatCurve';

type Setter = (key: keyof CrustPatch, value: number | boolean | string) => void;

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
    <div className="text-[7px] font-semibold text-muted-foreground/40 uppercase tracking-widest mb-1.5">
        {children}
    </div>
);

const Pill = ({
    label, active, onClick, color = '#5B8FC4',
}: {
    label: string; active: boolean; onClick: () => void; color?: string;
}): ReactElement => (
    <button
        type="button"
        onClick={onClick}
        className="px-2 py-0.5 rounded text-[9px] font-medium transition-all"
        style={active ? { background: color, color: '#0E0E10' } : { background: '#1E1E22', color: '#8A8890' }}
    >
        {label}
    </button>
);

/** Toggle switch rendered as a button (not a label+input pair — avoids semantic mismatch). */
const SwitchButton = ({
    id, label, checked, onChange,
}: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }): ReactElement => (
    <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="rounded px-2 py-0.5 text-[9px] font-medium transition-all"
        style={
            checked
                ? { background: '#5B8FC4', color: '#E8E6E0' }
                : { background: '#1E1E22', color: '#52515A' }
        }
    >
        {label}
    </button>
);

function fmtKnob(v: number, unit?: string): string {
    if (unit === 'ms') { return v === 0 ? 'Auto' : `${v.toFixed(0)}ms`; }
    if (unit === 'dB') { return `${v > 0 ? '+' : ''}${v.toFixed(1)}`; }
    if (unit === 'Hz') { return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`; }
    if (unit === '%') { return `${Math.round(v)}%`; }
    return v.toFixed(1);
}

const Knob = ({
    value, onChange, label, min, max, step, unit, def,
}: {
    value: number; onChange: (v: number) => void; label: string;
    min: number; max: number; step: number; unit?: string; def: number;
}): ReactElement => (
    <div className="flex flex-col items-center gap-0.5">
        <RotaryKnob
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={def}
            size="sm"
        />
        <span className="text-[7px] text-muted-foreground/60 leading-none">{label}</span>
        {unit !== undefined ? (
            <span className="text-[6px] font-mono text-muted-foreground/40">{fmtKnob(value, unit)}</span>
        ) : null}
    </div>
);

// ── Algorithm data ────────────────────────────────────────────────────────────

const ALGORITHMS = [
    { id: 'transparent', label: 'Transparent', desc: 'Clean ceiling, no color' },
    { id: 'punchy',      label: 'Punchy',      desc: 'Snap & edge, rhythm' },
    { id: 'dynamic',     label: 'Dynamic',     desc: 'Enhances transients' },
    { id: 'allround',    label: 'Allround',    desc: 'Balanced loudness' },
    { id: 'aggressive',  label: 'Aggressive',  desc: 'Pushes hard' },
    { id: 'bus',         label: 'Bus',         desc: 'Glue and pump' },
    { id: 'safe',        label: 'Safe',        desc: 'Zero distortion' },
    { id: 'wall',        label: 'Wall',        desc: 'Max ceiling' },
] as const;

const SAT_ALGORITHMS = ['soft', 'hard', 'tape', 'tube', 'fold'] as const;

const DITHER_OPTIONS = [
    { id: 'off', label: 'Off' },
    { id: 'tpdf16', label: 'TPDF 16-bit' },
    { id: 'tpdf24', label: 'TPDF 24-bit' },
    { id: 'powr1', label: 'POW-R 1' },
    { id: 'powr2', label: 'POW-R 2' },
    { id: 'powr3', label: 'POW-R 3' },
] as const;

// ── Level sub-panels ──────────────────────────────────────────────────────────

const STYLE_TILES = [
    { id: 'transparent' as const, label: 'TRANSPARENT', sub: 'Preserves dynamics\nfor any mix' },
    { id: 'punchy'      as const, label: 'PUNCHY',      sub: 'Snap & punch\nfor rhythmic mixes' },
    { id: 'loud'        as const, label: 'LOUD',        sub: 'Maximum\nloudness' },
];

const Level1 = ({ patch, setParam }: { patch: CrustPatch; setParam: Setter }): ReactElement => (
    <div className="flex gap-2 h-full items-center px-2">
        {STYLE_TILES.map((tile) => {
            const active = patch.style === tile.id;
            return (
                <button
                    key={tile.id}
                    type="button"
                    className="flex-1 h-full flex flex-col items-center justify-center rounded-md transition-all border"
                    style={active
                        ? { background: '#28282E', borderColor: '#5B8FC4', borderLeftWidth: 3, padding: '8px' }
                        : { background: '#161619', borderColor: '#2E2E36', padding: '8px' }}
                    onClick={() => setParam('style', tile.id)}
                    aria-pressed={active}
                >
                    <span className="text-[11px] font-semibold leading-tight" style={{ color: active ? '#E8E6E0' : '#52515A' }}>
                        {tile.label}
                    </span>
                    <span className="text-[8px] text-muted-foreground/40 whitespace-pre-line text-center mt-1 leading-snug">
                        {tile.sub}
                    </span>
                </button>
            );
        })}
    </div>
);

const Level2Core = ({ patch, setParam }: { patch: CrustPatch; setParam: Setter }): ReactElement => (
    <div className="flex flex-col gap-2">
        {/* Algorithm pills */}
        <div>
            <SectionLabel>Algorithm</SectionLabel>
            <div className="flex flex-wrap gap-1">
                {ALGORITHMS.map((a) => (
                    <Pill
                        key={a.id}
                        label={a.label}
                        active={patch.algorithm === a.id}
                        onClick={() => setParam('algorithm', a.id)}
                    />
                ))}
            </div>
            <div className="text-[7px] text-muted-foreground/40 mt-0.5 min-h-[10px]">
                {ALGORITHMS.find((a) => a.id === patch.algorithm)?.desc ?? ''}
            </div>
        </div>

        {/* Timing knobs */}
        <div className="flex gap-3 items-end">
            <Knob
                value={patch.lookahead}
                onChange={(v) => setParam('lookahead', v)}
                label="Lookahead" min={0} max={10} step={0.1} unit="ms" def={2}
            />
            <Knob
                value={patch.attackAuto ? 0 : patch.attack}
                onChange={(v) => { setParam('attackAuto', v === 0); setParam('attack', v); }}
                label="Attack" min={0} max={100} step={0.5} unit="ms" def={0}
            />
            <Knob
                value={patch.releaseAuto ? 0 : patch.release}
                onChange={(v) => { setParam('releaseAuto', v === 0); setParam('release', v); }}
                label="Release" min={0} max={1000} step={5} unit="ms" def={0}
            />
        </div>

        {/* Channel link sliders */}
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <span className="text-[7px] text-muted-foreground/40 w-14 shrink-0">Link Trans</span>
                <input
                    type="range" min={0} max={100} step={1}
                    value={patch.channelLinkTransient}
                    onChange={(e) => setParam('channelLinkTransient', Number(e.target.value))}
                    className="flex-1 h-1 accent-[#5B8FC4]"
                    aria-label="Channel link transient"
                />
                <span className="text-[7px] font-mono text-muted-foreground/50 w-8 text-right shrink-0">
                    {patch.channelLinkTransient}%
                </span>
            </div>
            <div className="flex items-center gap-2">
                <span className="text-[7px] text-muted-foreground/40 w-14 shrink-0">Link Rel</span>
                <input
                    type="range" min={0} max={100} step={1}
                    value={patch.channelLinkRelease}
                    onChange={(e) => setParam('channelLinkRelease', Number(e.target.value))}
                    className="flex-1 h-1 accent-[#5B8FC4]"
                    aria-label="Channel link release"
                />
                <span className="text-[7px] font-mono text-muted-foreground/50 w-8 text-right shrink-0">
                    {patch.channelLinkRelease}%
                </span>
            </div>
        </div>
    </div>
);

const SatSection = ({ patch, setParam }: { patch: CrustPatch; setParam: Setter }): ReactElement => (
    <div
        className="flex flex-col gap-1.5 p-2 rounded-md"
        style={{
            background: '#1A1208',
            border: '1px solid rgba(46,46,54,0.4)',
            borderLeft: '3px solid #D4883A',
        }}
    >
        <div className="flex items-center justify-between">
            <span className="text-[7px] font-semibold uppercase tracking-widest" style={{ color: '#D4883A' }}>
                Saturation
            </span>
            <SwitchButton
                id="crust-sat-enabled"
                label={patch.satEnabled ? 'ON' : 'OFF'}
                checked={patch.satEnabled}
                onChange={(v) => setParam('satEnabled', v)}
            />
        </div>
        <div className="flex items-center gap-2">
            {/* Sat algorithm pills */}
            <div className="flex flex-wrap gap-0.5">
                {SAT_ALGORITHMS.map((a) => (
                    <button
                        key={a}
                        type="button"
                        className="px-1.5 py-0.5 rounded text-[8px] font-medium uppercase transition-all"
                        style={patch.satAlgorithm === a
                            ? { background: '#D4883A', color: '#0E0E10' }
                            : { background: '#1E1E22', color: '#52515A' }}
                        onClick={() => setParam('satAlgorithm', a)}
                        disabled={!patch.satEnabled}
                        aria-pressed={patch.satAlgorithm === a}
                    >
                        {a}
                    </button>
                ))}
            </div>

            {/* Transfer curve */}
            <CrustSatCurve algorithm={patch.satAlgorithm} drive={patch.satDrive} />

            {/* Drive + Mix knobs */}
            <div className="flex gap-2">
                <div className="flex flex-col items-center gap-0.5">
                    <Knob
                        value={patch.satDrive}
                        onChange={(v) => setParam('satDrive', v)}
                        label="Drive" min={0} max={18} step={0.1} unit="dB" def={0}
                    />
                    {patch.satDrive > 6 ? (
                        <span className="text-[6px] font-bold" style={{ color: '#C44030' }}>HOT</span>
                    ) : null}
                </div>
                <Knob
                    value={patch.satMix}
                    onChange={(v) => setParam('satMix', v)}
                    label="Mix" min={0} max={100} step={1} unit="%" def={0}
                />
            </div>
        </div>
    </div>
);

const Level3Extra = ({ patch, setParam }: { patch: CrustPatch; setParam: Setter }): ReactElement => (
    <div className="flex items-center gap-2 mt-1">
        <SwitchButton
            id="crust-delta"
            label="DELTA"
            checked={patch.deltaListen}
            onChange={(v) => setParam('deltaListen', v)}
        />
        <SwitchButton
            id="crust-unity"
            label="A=B"
            checked={patch.unityGain}
            onChange={(v) => setParam('unityGain', v)}
        />
    </div>
);

const Level4Extra = ({ patch, setParam }: { patch: CrustPatch; setParam: Setter }): ReactElement => (
    <div className="flex flex-col gap-2 mt-1 pt-1 border-t border-border/10">
        <div className="flex gap-3 flex-wrap">
            {/* Multi-band mode */}
            <div>
                <SectionLabel>Multi-band</SectionLabel>
                <div className="flex gap-0.5">
                    {(['wideband', '3band', '5band'] as const).map((mb) => (
                        <Pill
                            key={mb}
                            label={mb === 'wideband' ? 'Wide' : mb}
                            active={patch.multiBand === mb}
                            onClick={() => setParam('multiBand', mb)}
                        />
                    ))}
                </div>
            </div>

            {/* Stereo mode */}
            <div>
                <SectionLabel>Stereo</SectionLabel>
                <div className="flex gap-0.5">
                    {(['stereo', 'ms'] as const).map((sm) => (
                        <Pill
                            key={sm}
                            label={sm.toUpperCase()}
                            active={patch.stereoMode === sm}
                            onClick={() => setParam('stereoMode', sm)}
                        />
                    ))}
                </div>
            </div>

            {/* Sidechain HPF */}
            <div>
                <SectionLabel>SC HPF</SectionLabel>
                <div className="flex items-center gap-1">
                    <SwitchButton
                        id="crust-sc-hpf"
                        label={patch.scHpfEnabled ? 'ON' : 'OFF'}
                        checked={patch.scHpfEnabled}
                        onChange={(v) => setParam('scHpfEnabled', v)}
                    />
                    {patch.scHpfEnabled ? (
                        <Knob
                            value={patch.scHpfFreq}
                            onChange={(v) => setParam('scHpfFreq', v)}
                            label="HPF" min={20} max={200} step={1} unit="Hz" def={60}
                        />
                    ) : null}
                </div>
            </div>
        </div>

        {/* Dithering */}
        <div>
            <SectionLabel>Dithering</SectionLabel>
            <select
                value={patch.dither}
                onChange={(e) => setParam('dither', e.target.value)}
                className="h-6 rounded border border-border/30 bg-surface-inset text-[9px] text-foreground px-1"
                aria-label="Dither mode"
            >
                {DITHER_OPTIONS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                ))}
            </select>
            {patch.dither !== 'off' ? (
                <div className="flex gap-1 mt-1">
                    {([16, 24, 32] as const).map((bd) => (
                        <Pill
                            key={bd}
                            label={`${bd}-bit`}
                            active={patch.outputBitDepth === bd}
                            onClick={() => setParam('outputBitDepth', bd)}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    </div>
);

const Level5Stats = ({
    lufsIntegrated, lufsShortTerm, lufsMomentary, lra, truepeakMax, grDb,
}: {
    lufsIntegrated: number; lufsShortTerm: number; lufsMomentary: number;
    lra: number; truepeakMax: number; grDb: number;
}): ReactElement => {
    const rows: [string, string][] = [
        ['Integrated', `${lufsIntegrated.toFixed(1)} LUFS`],
        ['ST Max',     `${lufsShortTerm.toFixed(1)} LUFS`],
        ['MOM Max',    `${lufsMomentary.toFixed(1)} LUFS`],
        ['LRA',        `${lra.toFixed(1)} LU`],
        ['TP Max',     `${truepeakMax.toFixed(1)} dBTP`],
        ['GR Max',     `${grDb.toFixed(1)} dB`],
    ];
    return (
        <div
            className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1 pt-1 border-t border-border/10"
            aria-label="Loudness statistics"
            role="group"
        >
            {rows.map(([label, value]) => (
                <div key={label} className="flex justify-between items-baseline">
                    <span className="text-[7px] text-muted-foreground/40">{label}</span>
                    <span className="text-[8px] font-mono text-foreground/70">{value}</span>
                </div>
            ))}
        </div>
    );
};

// ── Main CrustControlZone ─────────────────────────────────────────────────────

export const CrustControlZone = ({
    patch, setParam, lufsIntegrated, lufsShortTerm, lufsMomentary, lra, truepeakMax, grDb,
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
        <div
            className="flex flex-col gap-2 px-2 py-1.5 overflow-y-auto animate-in fade-in duration-150"
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
        </div>
    );
};

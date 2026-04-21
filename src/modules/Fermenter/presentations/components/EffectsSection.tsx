/**
 * Effects section — visual-first design.
 * Each effect has an interactive visualization as the primary control surface,
 * with knobs for precise adjustment below.
 */
import { type ReactElement, useState } from 'react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { CompressorCurve } from '#/components/daw/visualizers/CompressorCurve';
import { DelayTaps } from '#/components/daw/visualizers/DelayTaps';
import { DistortionCurve } from '#/components/daw/visualizers/DistortionCurve';
import { EQCurve } from '#/components/daw/visualizers/EQCurve';

type EffectsSectionProps = {
    reverbMix: number;
    reverbDecay: number;
    delayTime: number;
    delayFeedback: number;
    delayMix: number;
    chorusRate: number;
    chorusDepth: number;
    chorusMix: number;
    phaserRate: number;
    phaserDepth: number;
    phaserMix: number;
    distDrive: number;
    distTone: number;
    distMix: number;
    compThreshold: number;
    compRatio: number;
    compAttack: number;
    compRelease: number;
    compMix: number;
    stereoWidth: number;
    masterGain: number;
    eqLowFreq?: number;
    eqLowGain?: number;
    eqLowQ?: number;
    eqMidFreq?: number;
    eqMidGain?: number;
    eqMidQ?: number;
    eqHighFreq?: number;
    eqHighGain?: number;
    eqHighQ?: number;
    onParam: (key: string, value: number) => void;
};

type FxTab = 'dist' | 'comp' | 'reverb' | 'delay' | 'mod' | 'eq' | 'master';

const TAB_ITEMS: Array<{ id: FxTab; label: string; color: string }> = [
    { id: 'dist', label: 'Dist', color: 'var(--color-state-danger)' },
    { id: 'comp', label: 'Comp', color: 'var(--color-accent-lavender)' },
    { id: 'reverb', label: 'Reverb', color: 'var(--color-accent-mint)' },
    { id: 'delay', label: 'Delay', color: 'var(--color-accent-cyan)' },
    { id: 'mod', label: 'Chorus/Phaser', color: 'var(--color-accent-peach)' },
    { id: 'eq', label: 'EQ', color: 'var(--color-accent-cyan)' },
    { id: 'master', label: 'Master', color: '#fff' },
];

const K = ({
    value,
    onChange,
    label,
    min,
    max,
    step,
    defaultValue,
    paramId,
}: {
    value: number;
    onChange: (v: number) => void;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    paramId: string;
}): ReactElement => (
    <RotaryKnob
        paramId={paramId}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        defaultValue={defaultValue}
        size="lg"
        label={label}
        tone="sage"
    />
);

export const EffectsSection = (props: EffectsSectionProps): ReactElement => {
    const { onParam } = props;
    const [activeTab, setActiveTab] = useState<FxTab>('dist');

    const renderContent = (): ReactElement => {
        switch (activeTab) {
            case 'dist':
                return (
                    <div className="flex items-start gap-4">
                        <DistortionCurve
                            drive={props.distDrive}
                            tone={props.distTone}
                            mix={props.distMix}
                            width={200}
                            height={120}
                            onParamChange={(id, v) => {
                                if (id === 'dist-drive') {
                                    onParam('distDrive', v);
                                } else if (id === 'dist-tone') {
                                    onParam('distTone', v);
                                } else if (id === 'dist-mix') {
                                    onParam('distMix', v);
                                }
                            }}
                        />
                        <div className="flex gap-2">
                            <K
                                paramId="distMix"
                                value={props.distMix}
                                onChange={(v) => onParam('distMix', v)}
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                            />
                            <K
                                paramId="distDrive"
                                value={props.distDrive}
                                onChange={(v) => onParam('distDrive', v)}
                                label="Drive"
                                min={0}
                                max={10}
                                step={0.1}
                                defaultValue={0}
                            />
                            <K
                                paramId="distTone"
                                value={props.distTone}
                                onChange={(v) => onParam('distTone', v)}
                                label="Tone"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.5}
                            />
                        </div>
                    </div>
                );
            case 'comp':
                return (
                    <div className="flex items-start gap-4">
                        <CompressorCurve
                            threshold={props.compThreshold}
                            ratio={props.compRatio}
                            knee={6}
                            makeup={0}
                            width={200}
                            height={120}
                            onParamChange={(id, v) => {
                                if (id === 'comp-threshold') {
                                    onParam('compThreshold', v);
                                } else if (id === 'comp-ratio') {
                                    onParam('compRatio', v);
                                }
                            }}
                        />
                        <div className="flex flex-wrap gap-2 max-w-[200px]">
                            <K
                                paramId="compMix"
                                value={props.compMix}
                                onChange={(v) => onParam('compMix', v)}
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                            />
                            <K
                                paramId="compThreshold"
                                value={props.compThreshold}
                                onChange={(v) => onParam('compThreshold', v)}
                                label="Thresh"
                                min={-60}
                                max={0}
                                step={1}
                                defaultValue={-20}
                            />
                            <K
                                paramId="compRatio"
                                value={props.compRatio}
                                onChange={(v) => onParam('compRatio', v)}
                                label="Ratio"
                                min={1}
                                max={20}
                                step={0.5}
                                defaultValue={4}
                            />
                            <K
                                paramId="compAttack"
                                value={props.compAttack}
                                onChange={(v) => onParam('compAttack', v)}
                                label="Attack"
                                min={0.1}
                                max={100}
                                step={0.1}
                                defaultValue={10}
                            />
                            <K
                                paramId="compRelease"
                                value={props.compRelease}
                                onChange={(v) => onParam('compRelease', v)}
                                label="Release"
                                min={10}
                                max={1000}
                                step={1}
                                defaultValue={100}
                            />
                        </div>
                    </div>
                );
            case 'reverb':
                return (
                    <div className="flex gap-3">
                        <K
                            paramId="reverbMix"
                            value={props.reverbMix}
                            onChange={(v) => onParam('reverbMix', v)}
                            label="Mix"
                            min={0}
                            max={1}
                            step={0.01}
                            defaultValue={0.2}
                        />
                        <K
                            paramId="reverbDecay"
                            value={props.reverbDecay}
                            onChange={(v) => onParam('reverbDecay', v)}
                            label="Decay"
                            min={0}
                            max={0.99}
                            step={0.01}
                            defaultValue={0.5}
                        />
                        <div className="flex gap-0.5 items-end pb-4">
                            {['Plate', 'FDN'].map((name, i) => (
                                <button
                                    key={name}
                                    type="button"
                                    className={`px-1.5 py-0.5 rounded text-[7px] font-medium transition-colors ${i === 0 ? 'bg-[var(--color-accent-mint)]/80 text-white' : 'text-muted-foreground/50 hover:text-foreground'}`}
                                    onClick={() => onParam('reverbType', i)}
                                >
                                    {name}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            case 'delay':
                return (
                    <div className="flex items-start gap-4">
                        <DelayTaps
                            time={props.delayTime}
                            feedback={props.delayFeedback}
                            mix={props.delayMix}
                            width={200}
                            height={100}
                            onParamChange={(id, v) => {
                                if (id === 'delay-time') {
                                    onParam('delayTime', v);
                                } else if (id === 'delay-feedback') {
                                    onParam('delayFeedback', v);
                                } else if (id === 'delay-mix') {
                                    onParam('delayMix', v);
                                }
                            }}
                        />
                        <div className="flex gap-2">
                            <K
                                paramId="delayMix"
                                value={props.delayMix}
                                onChange={(v) => onParam('delayMix', v)}
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                            />
                            <K
                                paramId="delayTime"
                                value={props.delayTime}
                                onChange={(v) => onParam('delayTime', v)}
                                label="Time"
                                min={10}
                                max={2000}
                                step={1}
                                defaultValue={375}
                            />
                            <K
                                paramId="delayFeedback"
                                value={props.delayFeedback}
                                onChange={(v) => onParam('delayFeedback', v)}
                                label="Feedback"
                                min={0}
                                max={0.95}
                                step={0.01}
                                defaultValue={0.35}
                            />
                        </div>
                    </div>
                );
            case 'mod':
                return (
                    <div className="flex gap-6">
                        <div className="space-y-1">
                            <div className="text-[9px] text-muted-foreground/70 font-medium">Chorus</div>
                            <div className="flex gap-2">
                                <K
                                    paramId="chorusMix"
                                    value={props.chorusMix}
                                    onChange={(v) => onParam('chorusMix', v)}
                                    label="Mix"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0}
                                />
                                <K
                                    paramId="chorusRate"
                                    value={props.chorusRate}
                                    onChange={(v) => onParam('chorusRate', v)}
                                    label="Rate"
                                    min={0.1}
                                    max={5}
                                    step={0.1}
                                    defaultValue={1.2}
                                />
                                <K
                                    paramId="chorusDepth"
                                    value={props.chorusDepth}
                                    onChange={(v) => onParam('chorusDepth', v)}
                                    label="Depth"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.4}
                                />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="text-[9px] text-muted-foreground/70 font-medium">Phaser</div>
                            <div className="flex gap-2">
                                <K
                                    paramId="phaserMix"
                                    value={props.phaserMix}
                                    onChange={(v) => onParam('phaserMix', v)}
                                    label="Mix"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0}
                                />
                                <K
                                    paramId="phaserRate"
                                    value={props.phaserRate}
                                    onChange={(v) => onParam('phaserRate', v)}
                                    label="Rate"
                                    min={0.1}
                                    max={5}
                                    step={0.1}
                                    defaultValue={0.5}
                                />
                                <K
                                    paramId="phaserDepth"
                                    value={props.phaserDepth}
                                    onChange={(v) => onParam('phaserDepth', v)}
                                    label="Depth"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.5}
                                />
                            </div>
                        </div>
                    </div>
                );
            case 'eq':
                return (
                    <div className="flex items-start gap-4">
                        <EQCurve
                            lowGain={props.eqLowGain ?? 0}
                            lowFreq={props.eqLowFreq ?? 100}
                            lowQ={props.eqLowQ ?? 1}
                            midGain={props.eqMidGain ?? 0}
                            midFreq={props.eqMidFreq ?? 1000}
                            midQ={props.eqMidQ ?? 1}
                            highGain={props.eqHighGain ?? 0}
                            highFreq={props.eqHighFreq ?? 8000}
                            highQ={props.eqHighQ ?? 1}
                            width={280}
                            height={120}
                            onParamChange={(id, v) => {
                                const map: Record<string, string> = {
                                    'eq-low-gain': 'eqLowGain',
                                    'eq-low-freq': 'eqLowFreq',
                                    'eq-low-q': 'eqLowQ',
                                    'eq-mid-gain': 'eqMidGain',
                                    'eq-mid-freq': 'eqMidFreq',
                                    'eq-mid-q': 'eqMidQ',
                                    'eq-high-gain': 'eqHighGain',
                                    'eq-high-freq': 'eqHighFreq',
                                    'eq-high-q': 'eqHighQ',
                                };
                                const key = map[id];
                                if (key) {
                                    onParam(key, v);
                                }
                            }}
                        />
                    </div>
                );
            case 'master':
                return (
                    <div className="flex items-end gap-4">
                        <div className="flex flex-col items-center gap-1">
                            <RotaryKnob
                                paramId="stereoWidth"
                                value={props.stereoWidth}
                                onChange={(v) => onParam('stereoWidth', v)}
                                min={0}
                                max={2}
                                step={0.01}
                                defaultValue={1}
                                size="xl"
                                tone="sage"
                            />
                            <span className="text-[9px] text-muted-foreground">Width</span>
                            <span className="text-[8px] text-muted-foreground/50 font-mono">
                                {props.stereoWidth < 0.01 ? 'Mono' : `${Math.round(props.stereoWidth * 100)}%`}
                            </span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <RotaryKnob
                                paramId="masterGain"
                                value={props.masterGain}
                                onChange={(v) => onParam('masterGain', v)}
                                min={0}
                                max={2}
                                step={0.01}
                                defaultValue={1}
                                size="xl"
                                tone="sage"
                            />
                            <span className="text-[9px] text-muted-foreground font-medium">Master</span>
                            <span className="text-[8px] text-muted-foreground/50 font-mono">
                                {(props.masterGain * 100).toFixed(0)}%
                            </span>
                        </div>
                    </div>
                );
        }

        return <></>;
    };

    return (
        <div className="space-y-2">
            {/* FX sub-tabs */}
            <div className="flex gap-0.5 flex-wrap">
                {TAB_ITEMS.map(({ id, label, color }) => (
                    <DawPluginChip
                        key={id}
                        active={activeTab === id}
                        tone={
                            id === 'dist'
                                ? 'danger'
                                : id === 'comp'
                                  ? 'lavender'
                                  : id === 'reverb'
                                    ? 'mint'
                                    : id === 'delay' || id === 'eq'
                                      ? 'cyan'
                                      : id === 'mod'
                                        ? 'peach'
                                        : 'neutral'
                        }
                        size="xs"
                        style={activeTab === id && id === 'master' ? { backgroundColor: color } : undefined}
                        onClick={() => setActiveTab(id)}
                    >
                        {label}
                    </DawPluginChip>
                ))}
            </div>

            {/* Active effect content */}
            <div className="min-h-[130px]">{renderContent()}</div>
        </div>
    );
};

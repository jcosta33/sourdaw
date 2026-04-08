import { type ReactElement, useEffect } from 'react';
import { useStore } from '#/infra/store/useStore';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricStrip } from '#/components/daw/DawPluginMetricStrip';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginRail } from '#/components/daw/DawPluginRail';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { SpectrogramView } from './SpectrogramView';
import {
    chamberStore,
    registerChamberInstance,
    updateChamberEngine,
    setChamberUILevel,
    type ChamberStoreState,
} from '../../stores/chamberStore';

export const ProofChamber = ({ instanceId }: { instanceId: string }): ReactElement => {
    useEffect(() => {
        registerChamberInstance(instanceId);
    }, [instanceId]);

    const defaultChamberState: ChamberStoreState = {
        activeInstanceId: null,
        instances: {},
    };
    const chamberValue = useStore(chamberStore, defaultChamberState);
    const state = chamberValue.instances[instanceId];

    if (!state) {
        return (
            <div className="proof-chamber-faceplate flex h-[500px] w-[600px] min-h-0 overflow-hidden p-3">
                <div className="proof-chamber-window flex flex-1 items-center justify-center rounded-[24px] text-sm text-white/58">
                    Loading Dutch Oven...
                </div>
            </div>
        );
    }

    const { engineState, uiLevel } = state;

    return (
        <div className="proof-chamber-faceplate flex h-[500px] w-[600px] min-h-0 gap-3 overflow-hidden p-3 text-white/90">
            <DawPluginRail scrollable={false} className="w-[220px] shrink-0">
                <DawPluginSectionCard
                    className="proof-chamber-window"
                    title="Dutch oven"
                    detail={<DawPluginLed tone="amber">{engineState.algorithm}</DawPluginLed>}
                    detailMode="badge"
                    titleClassName="text-[var(--color-accent-amber)]/72"
                >
                    <div>
                        <div className="text-[18px] font-semibold text-white/92">Legacy chamber</div>
                        <div className="mt-1 text-[11px] text-white/44">
                            Rebuilt onto the shared plugin shell without flattening the spectral view.
                        </div>
                    </div>

                    <DawPluginMetricStrip align="start" className="gap-1.5">
                        <DawPluginMetricTile
                            className="proof-chamber-window min-w-[84px]"
                            label="Mix"
                            value={`${(engineState.mix * 100).toFixed(0)}%`}
                            detail="Wet"
                        />
                        <DawPluginMetricTile
                            className="proof-chamber-window min-w-[84px]"
                            label="Decay"
                            value={`${engineState.decaySeconds.toFixed(1)}s`}
                            detail="Tail"
                        />
                    </DawPluginMetricStrip>

                    <div className="flex flex-wrap gap-1.5">
                        {[1, 2, 3, 4, 5].map((level) => (
                            <DawPluginChip
                                key={level}
                                active={uiLevel === level}
                                tone="cyan"
                                size="sm"
                                onClick={() => setChamberUILevel(instanceId, level as 1 | 2 | 3 | 4 | 5)}
                            >
                                L{level}
                            </DawPluginChip>
                        ))}
                    </div>
                </DawPluginSectionCard>

                {uiLevel >= 2 ? (
                    <DawPluginSectionCard
                        className="proof-chamber-window"
                        title="Motion"
                        titleClassName="text-[var(--color-accent-cyan)]/72"
                    >
                        <DawPluginMetricStrip align="start" className="gap-1.5">
                            <DawPluginMetricTile
                                className="proof-chamber-window min-w-[84px]"
                                label="Diffusion"
                                value={`${(engineState.diffusion * 100).toFixed(0)}%`}
                                detail="Scatter"
                            />
                            <DawPluginMetricTile
                                className="proof-chamber-window min-w-[84px]"
                                label="Mod"
                                value={`${engineState.modulationRateHz.toFixed(1)}Hz`}
                                detail={`${(engineState.modulationDepth * 100).toFixed(0)}%`}
                            />
                        </DawPluginMetricStrip>
                    </DawPluginSectionCard>
                ) : null}
            </DawPluginRail>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
                <DawPluginSectionCard
                    className="proof-chamber-window min-h-0 flex-1"
                    title="Spectral bloom"
                    detail={<DawPluginLed tone="cyan">Live field</DawPluginLed>}
                    detailMode="badge"
                    titleClassName="text-[var(--color-accent-cyan)]/72"
                >
                    <SpectrogramView isMocking={true} />
                </DawPluginSectionCard>

                <DawPluginSectionCard
                    className="proof-chamber-window"
                    title="Core controls"
                    titleClassName="text-[var(--color-accent-cyan)]/72"
                >
                    <div className="grid grid-cols-4 gap-5">
                        <KnobControl
                            label="Mix"
                            value={engineState.mix * 100}
                            onChange={(value) =>
                                updateChamberEngine(instanceId, (state) => ({ ...state, mix: value / 100 }))
                            }
                            displayValue={`${(engineState.mix * 100).toFixed(0)}%`}
                        />
                        <KnobControl
                            label="Size"
                            value={engineState.size * 100}
                            onChange={(value) =>
                                updateChamberEngine(instanceId, (state) => ({ ...state, size: value / 100 }))
                            }
                            displayValue={`${(engineState.size * 100).toFixed(0)}%`}
                        />
                        <KnobControl
                            label="Decay"
                            value={engineState.decaySeconds}
                            min={0.1}
                            max={30}
                            onChange={(value) =>
                                updateChamberEngine(instanceId, (state) => ({ ...state, decaySeconds: value }))
                            }
                            displayValue={`${engineState.decaySeconds.toFixed(1)}s`}
                        />
                        <KnobControl
                            label="Damping"
                            value={engineState.damping * 100}
                            onChange={(value) =>
                                updateChamberEngine(instanceId, (state) => ({ ...state, damping: value / 100 }))
                            }
                            displayValue={`${(engineState.damping * 100).toFixed(0)}%`}
                        />
                    </div>
                </DawPluginSectionCard>

                {uiLevel >= 2 ? (
                    <DawPluginSectionCard
                        className="proof-chamber-window"
                        title="Shape"
                        titleClassName="text-[var(--color-accent-cyan)]/72"
                    >
                        <div className="grid grid-cols-4 gap-5">
                            <KnobControl
                                label="Pre-delay"
                                value={engineState.preDelayMs}
                                min={0}
                                max={500}
                                onChange={(value) =>
                                    updateChamberEngine(instanceId, (state) => ({ ...state, preDelayMs: value }))
                                }
                                displayValue={`${engineState.preDelayMs.toFixed(0)} ms`}
                            />
                            <KnobControl
                                label="Diffusion"
                                value={engineState.diffusion * 100}
                                min={0}
                                max={100}
                                onChange={(value) =>
                                    updateChamberEngine(instanceId, (state) => ({ ...state, diffusion: value / 100 }))
                                }
                                displayValue={`${(engineState.diffusion * 100).toFixed(0)}%`}
                            />
                            <KnobControl
                                label="Mod rate"
                                value={engineState.modulationRateHz}
                                min={0.1}
                                max={5.0}
                                step={0.1}
                                onChange={(value) =>
                                    updateChamberEngine(instanceId, (state) => ({ ...state, modulationRateHz: value }))
                                }
                                displayValue={`${engineState.modulationRateHz.toFixed(1)} Hz`}
                            />
                            <KnobControl
                                label="Mod depth"
                                value={engineState.modulationDepth * 100}
                                min={0}
                                max={100}
                                onChange={(value) =>
                                    updateChamberEngine(instanceId, (state) => ({
                                        ...state,
                                        modulationDepth: value / 100,
                                    }))
                                }
                                displayValue={`${(engineState.modulationDepth * 100).toFixed(0)}%`}
                            />
                        </div>
                    </DawPluginSectionCard>
                ) : null}
            </div>
        </div>
    );
};

// UI Component for generic slider wrapper representing a DAW Knob
function KnobControl({
    label,
    value,
    min = 0,
    max = 100,
    step = 1,
    displayValue,
    onChange,
}: {
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    displayValue: string;
    onChange: (val: number) => void;
}) {
    return (
        <div className="flex flex-col items-center gap-1 rounded-[18px] border border-white/8 bg-[var(--color-bg-panelInset)] px-2 py-2 text-center shadow-[var(--shadow-elevation-inset)]">
            <RotaryKnob
                value={value}
                onChange={onChange}
                min={min}
                max={max}
                step={step}
                defaultValue={value}
                size="sm"
                tone="amber"
            />
            <span className="text-[8px] font-medium uppercase tracking-[0.22em] text-white/54">{label}</span>
            <span className="font-mono text-[9px] text-white/42">{displayValue}</span>
        </div>
    );
}

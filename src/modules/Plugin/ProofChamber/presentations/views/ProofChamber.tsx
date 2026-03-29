import { type ReactElement, useEffect, useSyncExternalStore } from 'react';
import { SpectrogramView } from './SpectrogramView';
import { Label } from '#/components/ui/label';
import { Slider } from '#/components/ui/slider';
import { Button } from '#/components/ui/button';
import { 
    chamberStore, 
    registerChamberInstance, 
    updateChamberEngine, 
    setChamberUILevel 
} from '../../stores/chamberStore';

export const ProofChamber = ({ instanceId }: { instanceId: string }): ReactElement => {
    // Initial registration
    useEffect(() => {
        registerChamberInstance(instanceId);
    }, [instanceId]);

    const state = useSyncExternalStore(
        (cb) => chamberStore.subscribe(() => cb()),
        () => chamberStore.value?.instances[instanceId],
        () => chamberStore.value?.instances[instanceId]
    );

    if (!state) return <div className="p-4">Loading Proof Chamber...</div>;

    const { engineState, uiLevel } = state;

    return (
        <div className="flex flex-col w-[600px] h-[500px] bg-card text-card-foreground border rounded-lg shadow-xl overflow-hidden">
            {/* Top Bar Label */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-background/50">
                <div className="flex items-center gap-2">
                    <span className="font-bold tracking-widest text-sm uppercase opacity-80">Proof Chamber</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent-foreground border border-accent/30 mix-blend-screen">{engineState.algorithm}</span>
                </div>
                
                {/* Level Toggle Buttons */}
                <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((lvl) => (
                        <Button 
                            key={lvl}
                            variant={uiLevel === lvl ? 'secondary' : 'ghost'} 
                            size="xs" 
                            className="h-6 w-6 text-[10px]"
                            onClick={() => setChamberUILevel(instanceId, lvl as 1 | 2 | 3 | 4 | 5)}
                        >
                            {lvl}
                        </Button>
                    ))}
                </div>
            </div>

            {/* Spectrogram Vis */}
            <div className="p-4 pb-0 relative">
                <SpectrogramView isMocking={true} />
            </div>

            {/* Level 1: Core Params */}
            <div className="grid grid-cols-4 gap-6 px-6 py-6 border-b border-border/10">
                <KnobControl 
                    label="Mix" 
                    value={engineState.mix * 100}
                    onChange={(val) => updateChamberEngine(instanceId, s => ({ ...s, mix: val / 100 }))}
                    displayValue={`${(engineState.mix * 100).toFixed(0)}%`}
                />
                <KnobControl 
                    label="Size" 
                    value={engineState.size * 100} 
                    onChange={(val) => updateChamberEngine(instanceId, s => ({ ...s, size: val / 100 }))}
                    displayValue={`${(engineState.size * 100).toFixed(0)}%`}
                />
                <KnobControl 
                    label="Decay" 
                    value={engineState.decaySeconds} 
                    min={0.1} max={30} 
                    onChange={(val) => updateChamberEngine(instanceId, s => ({ ...s, decaySeconds: val }))}
                    displayValue={`${engineState.decaySeconds.toFixed(1)}s`}
                />
                <KnobControl 
                    label="Damping" 
                    value={engineState.damping * 100} 
                    onChange={(val) => updateChamberEngine(instanceId, s => ({ ...s, damping: val / 100 }))}
                    displayValue={`${(engineState.damping * 100).toFixed(0)}`}
                />
            </div>

            {/* Level 2: Advanced Shape parameters */}
            {uiLevel >= 2 && (
                <div className="grid grid-cols-4 gap-6 px-6 py-4 bg-background/30 flex-1">
                    <KnobControl 
                        label="Pre-Delay" 
                        value={engineState.preDelayMs} min={0} max={500}
                        onChange={(val) => updateChamberEngine(instanceId, s => ({ ...s, preDelayMs: val }))}
                        displayValue={`${engineState.preDelayMs.toFixed(0)} ms`}
                    />
                    <KnobControl 
                        label="Diffusion" 
                        value={engineState.diffusion * 100} min={0} max={100}
                        onChange={(val) => updateChamberEngine(instanceId, s => ({ ...s, diffusion: val / 100 }))}
                        displayValue={`${(engineState.diffusion * 100).toFixed(0)}%`}
                    />
                    <KnobControl 
                        label="Mod Rate" 
                        value={engineState.modulationRateHz} min={0.1} max={5.0} step={0.1}
                        onChange={(val) => updateChamberEngine(instanceId, s => ({ ...s, modulationRateHz: val }))}
                        displayValue={`${engineState.modulationRateHz.toFixed(1)} Hz`}
                    />
                    <KnobControl 
                        label="Mod Depth" 
                        value={engineState.modulationDepth * 100} min={0} max={100}
                        onChange={(val) => updateChamberEngine(instanceId, s => ({ ...s, modulationDepth: val / 100 }))}
                        displayValue={`${(engineState.modulationDepth * 100).toFixed(0)}%`}
                    />
                </div>
            )}
        </div>
    );
};

// UI Component for generic slider wrapper representing a DAW Knob
function KnobControl({ label, value, min = 0, max = 100, step = 1, displayValue, onChange }: { 
    label: string, value: number, min?: number, max?: number, step?: number, displayValue: string, onChange: (val: number) => void 
}) {
    return (
        <div className="flex flex-col gap-2 items-center text-center">
            <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</Label>
            <Slider 
                value={[value]} min={min} max={max} step={step}
                onValueChange={([v]) => onChange(v!)}
                className="w-full"
            />
            <span className="text-[10px] font-mono text-foreground/80">{displayValue}</span>
        </div>
    );
}

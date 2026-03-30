/**
 * SignalFlowView — visual representation of the signal processing DAG.
 *
 * Shows input → crossover → per-band chains → summing → output.
 */
import { type ReactElement } from 'react';
import { type BacteriaBand, type BacteriaRoutingMode } from '../../models/BacteriaPatch';

type SignalFlowViewProps = {
    bandCount: number;
    bands: BacteriaBand[];
    globalRouting: BacteriaRoutingMode;
    crossoverFreqs: number[];
};

const BAND_COLORS = [
    'rgb(244,63,94)', // rose
    'rgb(251,146,60)', // orange
    'rgb(250,204,21)', // yellow
    'rgb(74,222,128)', // green
    'rgb(96,165,250)', // blue
    'rgb(167,139,250)', // violet
];

const EFFECT_LABELS: Record<string, string> = {
    distortionEnabled: 'Dist',
    filterEnabled: 'Filter',
    chorusEnabled: 'Chorus',
    granularEnabled: 'Grain',
    spectralEnabled: 'Spectral',
    freqShiftEnabled: 'FShift',
    lofiEnabled: 'Lo-Fi',
    convolutionEnabled: 'Body',
};

export const SignalFlowView = ({
    bandCount,
    bands,
    globalRouting,
    crossoverFreqs,
}: SignalFlowViewProps): ReactElement => {
    const routingLabel = globalRouting === 'serial' ? 'Serial' : globalRouting === 'parallel' ? 'Parallel' : 'Mid/Side';

    return (
        <div className="flex flex-col gap-3 h-full overflow-y-auto">
            {/* Input node */}
            <div className="flex justify-center">
                <div className="px-3 py-1 rounded-md border border-rose-500/30 bg-rose-500/10 text-[9px] font-medium text-rose-300">
                    Input
                </div>
            </div>

            {/* Crossover split */}
            {bandCount > 1 ? (
                <div className="flex justify-center">
                    <div className="px-2 py-0.5 rounded border border-border/30 bg-surface-inset text-[7px] text-muted-foreground">
                        Crossover (
                        {crossoverFreqs
                            .slice(0, bandCount - 1)
                            .map((f) => (f >= 1000 ? `${(f / 1000).toFixed(1)}k` : `${f}`))
                            .join(' | ')}
                        )
                    </div>
                </div>
            ) : null}

            {/* Band chains */}
            <div
                className={`flex gap-2 justify-center ${globalRouting === 'serial' ? 'flex-col items-center' : 'flex-row'}`}
            >
                {Array.from({ length: bandCount }, (_, i) => {
                    const band = bands[i]!;
                    const color = BAND_COLORS[i % BAND_COLORS.length]!;
                    const enabledEffects = Object.entries(EFFECT_LABELS)
                        .filter(([key]) => band[key as keyof BacteriaBand] === true)
                        .map(([, label]) => label);

                    return (
                        <div key={i} className="flex flex-col items-center gap-1 min-w-[80px]">
                            <div
                                className="px-2 py-0.5 rounded text-[7px] font-bold"
                                style={{
                                    color,
                                    borderColor: color,
                                    border: '1px solid',
                                    backgroundColor: `${color}10`,
                                }}
                            >
                                Band {i + 1}
                            </div>
                            {enabledEffects.length > 0 ? (
                                <div className="flex flex-col gap-0.5">
                                    {enabledEffects.map((effect) => (
                                        <div
                                            key={effect}
                                            className="px-1.5 py-0.5 rounded text-[6px] font-medium bg-surface-raised text-muted-foreground border border-border/20 text-center"
                                        >
                                            {effect}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="px-1.5 py-0.5 rounded text-[6px] text-muted-foreground/30 border border-border/10 text-center">
                                    bypass
                                </div>
                            )}
                            {band.mute ? <span className="text-[6px] text-red-400 font-bold">MUTED</span> : null}
                        </div>
                    );
                })}
            </div>

            {/* Routing mode indicator */}
            <div className="flex justify-center">
                <div className="px-2 py-0.5 rounded border border-border/30 bg-surface-inset text-[7px] text-muted-foreground">
                    {routingLabel} Sum
                </div>
            </div>

            {/* Output node */}
            <div className="flex justify-center">
                <div className="px-3 py-1 rounded-md border border-rose-500/30 bg-rose-500/10 text-[9px] font-medium text-rose-300">
                    Output
                </div>
            </div>
        </div>
    );
};

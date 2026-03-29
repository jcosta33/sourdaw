/**
 * PerformancePanel — auto-divisi, auto-articulation, ensemble timing controls.
 *
 * Level 6 (Lab): full performance intelligence tuning.
 * Toggle callbacks are provided by the parent to properly wire to the engine.
 */
import { type ReactElement } from 'react';

type PerformancePanelProps = {
    autoDivisiEnabled: boolean;
    autoArticulationEnabled: boolean;
    ensembleTimingEnabled: boolean;
    onToggleDivisi: () => void;
    onToggleArticulation: () => void;
    onToggleEnsemble: () => void;
};

export const PerformancePanel = ({
    autoDivisiEnabled,
    autoArticulationEnabled,
    ensembleTimingEnabled,
    onToggleDivisi,
    onToggleArticulation,
    onToggleEnsemble,
}: PerformancePanelProps): ReactElement => {
    return (
        <div className="flex flex-col gap-3">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                Performance Intelligence
            </span>

            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <button
                        className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                            autoDivisiEnabled
                                ? 'bg-blue-500/20 text-blue-300'
                                : 'text-zinc-500 hover:bg-zinc-800'
                        }`}
                        onClick={onToggleDivisi}
                    >
                        Auto-Divisi
                    </button>
                    <span className="text-[9px] text-zinc-600">
                        Splits chords across section players
                    </span>
                </div>
            </div>

            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <button
                        className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                            autoArticulationEnabled
                                ? 'bg-blue-500/20 text-blue-300'
                                : 'text-zinc-500 hover:bg-zinc-800'
                        }`}
                        onClick={onToggleArticulation}
                    >
                        Auto-Articulate
                    </button>
                    <span className="text-[9px] text-zinc-600">
                        Selects articulation from playing patterns
                    </span>
                </div>
            </div>

            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <button
                        className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                            ensembleTimingEnabled
                                ? 'bg-blue-500/20 text-blue-300'
                                : 'text-zinc-500 hover:bg-zinc-800'
                        }`}
                        onClick={onToggleEnsemble}
                    >
                        Ensemble Timing
                    </button>
                    <span className="text-[9px] text-zinc-600">
                        Attack spread, pitch convergence, dynamic bloom
                    </span>
                </div>
            </div>
        </div>
    );
};

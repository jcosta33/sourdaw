/**
 * OrchestraPresetBrowser — browse and load orchestral presets.
 *
 * Organized by category (strings, brass, woodwinds, percussion)
 * and complexity level (play, shape, build). Follows progressive disclosure:
 * Level 1 shows only "Play" presets, higher levels show all.
 */
import { type ReactElement } from 'react';
import {
    FACTORY_PRESETS,
    type PresetEntry,
    type PresetCategory,
} from '../../repositories/orchestralPresets';
import { loadFactoryPreset } from '../../useCases/loadPreset';
import { type OrchestraUiLevel } from '../../stores/orchestralStore';

type OrchestraPresetBrowserProps = {
    currentPresetName: string;
    uiLevel: OrchestraUiLevel;
};

const CATEGORY_ORDER: PresetCategory[] = ['strings', 'brass', 'woodwinds', 'percussion', 'choir', 'ensemble'];

const CATEGORY_LABELS: Record<PresetCategory, string> = {
    strings: 'Strings',
    brass: 'Brass',
    woodwinds: 'Woodwinds',
    percussion: 'Percussion',
    choir: 'Choir',
    ensemble: 'Ensembles',
};

export const OrchestraPresetBrowser = ({
    currentPresetName,
    uiLevel,
}: OrchestraPresetBrowserProps): ReactElement => {
    // Filter presets based on UI level.
    const visiblePresets = FACTORY_PRESETS.filter((p) => {
        if (uiLevel <= 1) {
            return p.level === 'play';
        }
        if (uiLevel <= 2) {
            return p.level === 'play' || p.level === 'shape';
        }
        return true;
    });

    // Group by category.
    const grouped = new Map<PresetCategory, PresetEntry[]>();
    for (const preset of visiblePresets) {
        const group = grouped.get(preset.category) ?? [];
        group.push(preset);
        grouped.set(preset.category, group);
    }

    return (
        <div className="flex flex-col gap-2 p-2 overflow-y-auto">
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider px-1">
                Presets
            </span>
            {CATEGORY_ORDER.map((category) => {
                const presets = grouped.get(category);
                if (!presets || presets.length === 0) {
                    return null;
                }

                return (
                    <div key={category}>
                        <span className="text-[10px] text-zinc-600 uppercase tracking-wider px-1">
                            {CATEGORY_LABELS[category]}
                        </span>
                        <div className="flex flex-col gap-0.5 mt-1">
                            {presets.map((preset) => {
                                const isActive = currentPresetName === preset.name;
                                return (
                                    <button
                                        key={preset.id}
                                        className={`text-left px-2 py-1 rounded text-xs transition-colors ${
                                            isActive
                                                ? 'bg-amber-500/20 text-amber-300'
                                                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                                        }`}
                                        onClick={() => loadFactoryPreset(preset.id)}
                                        title={preset.description}
                                    >
                                        {preset.name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

import { type ReactElement } from 'react';
import { Waves, Plus, Sliders, Music2 } from 'lucide-react';
import { type BUILTIN_PLUGINS } from '../../../useCases/workspaceViewActions';
import { addDevice } from '../../../useCases/workspaceViewActions';
import { PluginBrowser } from '#/modules/AudioEngine/presentations/views/PluginBrowser';
import { MODULATOR_PRESETS } from '#/modules/AudioEngine/useCases/modulatorLibrary';
import { MIDI_EFFECT_FACTORIES } from '#/modules/AudioEngine/useCases/midiEffectPlugins';

type EffectsTabProps = {
    plugins: typeof BUILTIN_PLUGINS;
    selectedTrackId: string | null;
    searchQuery: string;
};

export const EffectsTab = ({ plugins, selectedTrackId, searchQuery }: EffectsTabProps): ReactElement => {
    const effects = plugins.filter((p) => p.category !== 'instrument');
    const query = searchQuery.toLowerCase().trim();

    const filteredModulators = MODULATOR_PRESETS.filter(
        (p) => !query || p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)
    );
    const filteredMidiEffects = MIDI_EFFECT_FACTORIES.filter((m) => !query || m.name.toLowerCase().includes(query));

    return (
        <div className="space-y-1">
            <div className="flex items-center gap-1 px-1 py-0.5">
                <Waves className="size-3 text-muted-foreground" aria-hidden="true" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase">Effects</span>
            </div>
            {effects.map((plugin) => (
                <div
                    key={plugin.id}
                    className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-accent/50 cursor-grab active:cursor-grabbing"
                    draggable
                    onDragStart={(e) => {
                        e.dataTransfer.setData(
                            'application/x-webdaw-plugin',
                            JSON.stringify({ name: plugin.name, id: plugin.id })
                        );
                        e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => {
                        if (selectedTrackId) {
                            addDevice(selectedTrackId, plugin.name);
                        }
                    }}
                    title="Drag to timeline or click to add to selected track"
                >
                    <div>
                        <span className="text-xs text-foreground">{plugin.name}</span>
                        <span className="ml-1 text-[9px] text-muted-foreground capitalize">{plugin.category}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-[9px] text-muted-foreground">{plugin.parameters.length} params</span>
                        {selectedTrackId ? <Plus className="size-3 text-muted-foreground" /> : null}
                    </div>
                </div>
            ))}

            {/* Modulator Presets */}
            {filteredModulators.length > 0 && (
                <>
                    <div className="flex items-center gap-1 px-1 py-0.5 pt-2">
                        <Sliders className="size-3 text-muted-foreground" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            Modulators
                        </span>
                    </div>
                    {filteredModulators.map((preset) => (
                        <div
                            key={preset.id}
                            className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-surface-raised border border-transparent hover:border-border/40 transition-colors cursor-pointer group"
                            title={preset.description}
                        >
                            <div>
                                <span className="text-[11px] font-medium text-foreground/90">{preset.name}</span>
                                <span className="ml-1 text-[9px] text-muted-foreground">{preset.category}</span>
                            </div>
                            <span className="text-[8px] font-medium px-1 py-0.5 rounded bg-purple-500/20 text-purple-400 capitalize">
                                {preset.sourceType}
                            </span>
                        </div>
                    ))}
                </>
            )}

            {/* MIDI Effects */}
            {filteredMidiEffects.length > 0 && (
                <>
                    <div className="flex items-center gap-1 px-1 py-0.5 pt-2">
                        <Music2 className="size-3 text-muted-foreground" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            MIDI Effects
                        </span>
                    </div>
                    {filteredMidiEffects.map((effect) => (
                        <div
                            key={effect.id}
                            className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-surface-raised border border-transparent hover:border-border/40 transition-colors cursor-pointer group"
                            onClick={() => effect.create()}
                            title={effect.name}
                        >
                            <div>
                                <span className="text-[11px] font-medium text-foreground/90">{effect.name}</span>
                            </div>
                            <span className="text-[9px] text-muted-foreground group-hover:text-foreground/70 transition-colors">
                                MIDI FX
                            </span>
                        </div>
                    ))}
                </>
            )}

            <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
        </div>
    );
};

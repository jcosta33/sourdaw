import { type ReactElement } from 'react';
import { Waves, Plus } from 'lucide-react';
import { type BUILTIN_PLUGINS } from '../../../useCases/workspaceViewActions';
import { addDevice } from '../../../useCases/workspaceViewActions';
import { PluginBrowser } from '#/modules/AudioEngine/presentations/views/PluginBrowser';

export type EffectsTabProps = {
    plugins: typeof BUILTIN_PLUGINS;
    selectedTrackId: string | null;
    searchQuery: string;
};

export const EffectsTab = ({ plugins, selectedTrackId, searchQuery }: EffectsTabProps): ReactElement => {
    const effects = plugins.filter((p) => p.category !== 'instrument');

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

            <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
        </div>
    );
};

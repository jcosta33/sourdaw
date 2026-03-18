import { type CSSProperties, type ReactElement, useState, useSyncExternalStore } from 'react';
import { ScrollArea } from '#/components/ui/scroll-area';
import { useTracks } from '../hooks/useTracks';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { TrackInspector } from './inspector/TrackInspector';
import { ClipInspector } from './inspector/ClipInspector';
import { DeviceInspector } from './inspector/DeviceInspector';

type InspectorPanelProps = {
    style?: CSSProperties;
};

export const InspectorPanel = ({ style }: InspectorPanelProps): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const selectedTrack = tracks.find((t) => t.id === selectedTrackId);
    const wsSelectedClipId = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(cb),
        () => workspaceStore.value?.selectedClipId ?? null
    );
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

    const selectedClip = selectedTrack?.clips.find((c) => c.id === wsSelectedClipId) ?? null;
    const selectedDevice = selectedTrack?.devices.find((d) => d.id === selectedDeviceId) ?? null;

    return (
        <aside
            className="flex shrink-0 flex-col border-r border-border/50 bg-surface-raised"
            style={style}
            aria-label="Inspector panel"
        >
            <div className="border-b border-border/50 px-3 py-2">
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Inspector</h2>
            </div>

            <ScrollArea className="flex-1">
                {selectedDevice && selectedTrack ? (
                    <DeviceInspector
                        device={selectedDevice}
                        trackId={selectedTrack.id}
                        onBack={() => setSelectedDeviceId(null)}
                    />
                ) : selectedClip && selectedTrack ? (
                    <ClipInspector
                        clip={selectedClip}
                        trackId={selectedTrack.id}
                        onBack={() => {
                            const ws = workspaceStore.value;
                            if (ws) {
                                workspaceStore.set({ ...ws, selectedClipId: null, selectedClipIds: [] });
                            }
                        }}
                    />
                ) : selectedTrack ? (
                    <TrackInspector
                        track={selectedTrack}
                        allTracks={tracks}
                        onSelectClip={(id) => {
                            const ws = workspaceStore.value;
                            if (ws) {
                                workspaceStore.set({ ...ws, selectedClipId: id, selectedClipIds: [id] });
                            }
                        }}
                        onSelectDevice={setSelectedDeviceId}
                    />
                ) : (
                    <div className="p-3">
                        <p className="text-xs text-muted-foreground">
                            Select a track, clip, or device to inspect its properties.
                        </p>
                    </div>
                )}
            </ScrollArea>
        </aside>
    );
};

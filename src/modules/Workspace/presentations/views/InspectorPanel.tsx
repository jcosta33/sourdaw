import { type CSSProperties, type ReactElement, useState, useSyncExternalStore } from 'react';
import { ScrollArea } from '#/components/ui/scroll-area';
import { Button } from '#/components/ui/button';
import { X } from 'lucide-react';
import { useTracks } from '../hooks/useTracks';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { toggleInspector, clearClipSelection, selectClipWithFocus } from '../../useCases/togglePanel';
import { TrackInspector } from './Inspector/TrackInspector';
import { ClipInspector } from './Inspector/ClipInspector';
import { DeviceInspector } from './Inspector/DeviceInspector';

type InspectorPanelProps = {
    style?: CSSProperties;
};

export const InspectorPanel = ({ style }: InspectorPanelProps): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const masterTrack = tracks.find((t) => t.kind === 'master');

    const selectedTrack = (selectedTrackId ? tracks.find((t) => t.id === selectedTrackId) : null) ?? masterTrack ?? null;
    const wsSelectedClipId = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(cb),
        () => workspaceStore.value?.selectedClipId ?? null
    );
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

    const selectedClip = selectedTrack?.clips.find((c) => c.id === wsSelectedClipId) ?? null;
    const selectedDevice = selectedTrack?.devices.find((d) => d.id === selectedDeviceId) ?? null;

    return (
        <aside
            className="contain-strict flex shrink-0 flex-col border-l border-border-hairline bg-surface-tray shadow-[inset_1px_0_0_rgba(255,255,255,0.02)]"
            style={style}
            aria-label="Inspector panel"
        >
            <div className="flex flex-row items-center justify-between border-b border-border/50 px-3 py-2">
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Inspector</h2>
                <Button variant="ghost" size="icon-xs" onClick={toggleInspector} aria-label="Close inspector">
                    <X className="size-3.5" />
                </Button>
            </div>

            <ScrollArea className="flex-1 min-h-0">
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
                        onBack={clearClipSelection}
                    />
                ) : selectedTrack ? (
                    <TrackInspector
                        track={selectedTrack}
                        allTracks={tracks}
                        onSelectClip={selectClipWithFocus}
                        onSelectDevice={setSelectedDeviceId}
                    />
                ) : masterTrack ? (
                    <TrackInspector
                        track={masterTrack}
                        allTracks={tracks}
                        onSelectClip={selectClipWithFocus}
                        onSelectDevice={setSelectedDeviceId}
                    />
                ) : (
                    <div className="flex items-center justify-center h-full p-6">
                        <p className="text-xs text-muted-foreground text-center">
                            Select a track to inspect its properties.
                        </p>
                    </div>
                )}
            </ScrollArea>
        </aside>
    );
};

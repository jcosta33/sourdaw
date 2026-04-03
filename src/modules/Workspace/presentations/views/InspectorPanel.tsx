import { type CSSProperties, type ReactElement, useState, useSyncExternalStore } from 'react';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { ScrollArea } from '#/components/ui/scroll-area';
import { Button } from '#/components/ui/button';
import { X } from 'lucide-react';
import { useTracks } from '../hooks/useTracks';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { toggleInspector, clearClipSelection, selectClipWithFocus } from '../../useCases/togglePanel/panelToggles';
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

    const isDeviceView = !!selectedDevice;

    return (
        <aside
            className="contain-strict flex shrink-0 flex-col border-l border-border-hairline bg-surface-tray shadow-[inset_1px_0_0_rgba(255,255,255,0.02),inset_0_1px_0_rgba(255,255,255,0.04)] transition-[width,min-width] duration-200 ease-out"
            style={{
                ...style,
                width: isDeviceView ? Math.max((style?.width as number) ?? 260, 320) : (style?.width as number) ?? 260,
                minWidth: isDeviceView ? 300 : 200,
            }}
            aria-label="Inspector panel"
        >
            <DawHeaderBand
                className="rounded-none px-3 py-2"
                title="Inspector"
                titleClassName="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                actions={
                    <Button variant="ghost" size="icon-xs" onClick={toggleInspector} aria-label="Close inspector">
                        <X className="size-3.5" />
                    </Button>
                }
            />

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
                    <div className="flex h-full items-center justify-center p-6">
                        <DawEmptyState
                            className="max-w-64"
                            title="No track selected"
                            description="Pick a track, clip, or device to inspect its details."
                        />
                    </div>
                )}
            </ScrollArea>
        </aside>
    );
};

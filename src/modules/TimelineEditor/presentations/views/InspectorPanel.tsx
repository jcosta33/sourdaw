import { type CSSProperties, type ReactElement, useState } from 'react';

import { X } from 'lucide-react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { ScrollArea } from '#/components/ui/scroll-area';
import { useStore } from '#/infra/store/useStore';
import { clipSelectionStore, defaultClipSelectionState } from '#/modules/Arrangement/stores';
import { clearClipSelection, selectClipWithFocus } from '#/modules/Arrangement/useCases';
import { toggleInspector } from '#/modules/WorkspaceShell/useCases';

import { useTracks } from '../hooks/useTracks';

import { ClipInspector } from './Inspector/ClipInspector';
import { DeviceInspector } from './Inspector/DeviceInspector';
import { TrackInspector } from './Inspector/TrackInspector';

type InspectorPanelProps = {
    style?: CSSProperties;
};

export const InspectorPanel = ({ style }: InspectorPanelProps): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const masterTrack = tracks.find((time) => time.kind === 'master');

    const selectedTrack =
        (selectedTrackId ? tracks.find((time) => time.id === selectedTrackId) : null) ?? masterTrack ?? null;
    const wsSelectedClipId = useStore(clipSelectionStore, defaultClipSelectionState).selectedClipId;
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

    const selectedClip = selectedTrack?.clips.find((context) => context.id === wsSelectedClipId) ?? null;
    const selectedDevice = selectedTrack?.devices.find((data) => data.id === selectedDeviceId) ?? null;

    const isDeviceView = !!selectedDevice;
    const renderIife_22 = () => {
        if (selectedDevice && selectedTrack) {
            return (
                <DeviceInspector
                    device={selectedDevice}
                    trackId={selectedTrack.id}
                    onBack={() => setSelectedDeviceId(null)}
                />
            );
        } else {
            if (selectedClip && selectedTrack) {
                // Keyed by clip id: ClipInspector owns local rename-draft state that
                // must not survive a selection change, and remounting is the only
                // way to guarantee that without the component resyncing on every
                // clip prop it renders from.
                return (
                    <ClipInspector
                        key={selectedClip.id}
                        clip={selectedClip}
                        trackId={selectedTrack.id}
                        onBack={clearClipSelection}
                    />
                );
            } else {
                if (selectedTrack) {
                    return (
                        <TrackInspector
                            track={selectedTrack}
                            allTracks={tracks}
                            onSelectClip={selectClipWithFocus}
                            onSelectDevice={setSelectedDeviceId}
                        />
                    );
                } else {
                    if (masterTrack) {
                        return (
                            <TrackInspector
                                track={masterTrack}
                                allTracks={tracks}
                                onSelectClip={selectClipWithFocus}
                                onSelectDevice={setSelectedDeviceId}
                            />
                        );
                    } else {
                        return (
                            <Row justify="center" className="h-full p-6">
                                <DawBlockedState
                                    eyebrow="Inspector"
                                    className="max-w-64"
                                    title="No track selected"
                                    description="Pick a track, clip, or device to inspect its details."
                                    summary="The inspector follows the current selection and switches between track, clip, and device detail."
                                />
                            </Row>
                        );
                    }
                }
            }
        }
    };

    return (
        <DawPanelSurface
            as="aside"
            tone="tray"
            className="transition-[width,min-width] duration-200 ease-out"
            style={{
                ...style,
                width: isDeviceView ? Math.max((style?.width as number) ?? 260, 320) : (style?.width ?? 260),
                minWidth: isDeviceView ? 300 : 200,
            }}
            aria-label="Inspector panel"
            data-onboarding="inspector"
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
            <ScrollArea className="flex-1 min-h-0">{renderIife_22()}</ScrollArea>
        </DawPanelSurface>
    );
};

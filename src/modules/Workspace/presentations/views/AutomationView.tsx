import { type ReactElement, type WheelEvent, useRef, useSyncExternalStore } from 'react';
import { ArrangementBar } from '#/modules/Arrangement/presentations/views/ArrangementBar';
import { timelineViewStore, scrollTimeline, setScrollY } from '#/modules/Arrangement/stores/timelineViewStore';
import { useTracks } from '../hooks/useTracks';
import { TrackAutomationSection } from './AutomationView/TrackAutomationSection';
import { Button } from '#/components/ui/button';
import { X } from 'lucide-react';
import { toggleAutomationPanel } from '../../useCases/togglePanel';

export const AutomationView = (): ReactElement => {
    const { tracks } = useTracks();
    const containerRef = useRef<HTMLDivElement>(null);

    const viewState = useSyncExternalStore(
        (cb) => timelineViewStore.subscribe(() => cb()),
        () => timelineViewStore.value,
        () => timelineViewStore.value
    );

    const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;
    const scrollX = viewState?.scrollX ?? 0;
    const containerWidth = containerRef.current?.clientWidth ?? 800;

    const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
        if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
            scrollTimeline(event.deltaX || event.deltaY);
        } else {
            const currentY = timelineViewStore.value?.scrollY ?? 0;
            setScrollY(Math.max(0, currentY + event.deltaY));
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden relative" ref={containerRef}>
            <ArrangementBar pixelsPerBeat={pixelsPerBeat} scrollX={scrollX} />
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={toggleAutomationPanel}
                className="absolute top-[2px] right-2 z-50 text-muted-foreground hover:text-foreground"
                aria-label="Close automation panel"
            >
                <X className="size-3.5" />
            </Button>
            <div className="flex-1 overflow-y-auto bg-surface-base/50" onWheel={handleWheel}>
                {tracks.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center space-y-2">
                            <p className="text-sm text-muted-foreground">No tracks yet</p>
                            <p className="text-[10px] text-muted-foreground/60">
                                Add tracks in the Arrange view first, then return here to add automation
                            </p>
                        </div>
                    </div>
                ) : (
                    tracks.map((track) => (
                        <TrackAutomationSection
                            key={track.id}
                            trackId={track.id}
                            trackName={track.name}
                            trackColor={track.color ?? 'var(--color-palette-steel)'}
                            automationMode={track.automationMode}
                            devices={track.devices.map((d) => ({ type: d.type, name: d.name }))}
                            pixelsPerBeat={pixelsPerBeat}
                            scrollX={scrollX}
                            containerWidth={containerWidth}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

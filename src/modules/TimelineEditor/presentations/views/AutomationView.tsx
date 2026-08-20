import { type ReactElement, type WheelEvent, useRef } from 'react';

import { X } from 'lucide-react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { ArrangementBar } from '#/modules/Arrangement/presentations/views';
import { timelineViewStore } from '#/modules/Arrangement/stores';
import { scrollTimelineViewportFromWheel } from '#/modules/Arrangement/useCases';
import { toggleAutomationPanel } from '#/modules/WorkspaceShell/useCases';

import { useTracks } from '../hooks/useTracks';

import { TrackAutomationSection } from './AutomationView/TrackAutomationSection';

type AutomationTimelineState = {
    scrollX: number;
    scrollY: number;
    pixelsPerBeat: number;
    autoScrollEnabled: boolean;
};

export const AutomationView = (): ReactElement => {
    const { tracks } = useTracks();
    const containerRef = useRef<HTMLDivElement>(null);

    const viewState = useStore<AutomationTimelineState>(timelineViewStore, {
        scrollX: 0,
        scrollY: 0,
        pixelsPerBeat: 12,
        autoScrollEnabled: true,
    });

    const pixelsPerBeat = viewState.pixelsPerBeat;
    const scrollX = viewState.scrollX;
    const containerWidth = containerRef.current?.clientWidth ?? 800;

    const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
        scrollTimelineViewportFromWheel({
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            shiftKey: event.shiftKey,
            viewportHeight: event.currentTarget.clientHeight,
        });
    };

    return (
        <Stack className="h-full overflow-hidden relative" ref={containerRef}>
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
                    <Row justify="center" className="h-full p-6">
                        <DawBlockedState
                            eyebrow="Automation"
                            title="No tracks yet"
                            description="Add tracks in Arrange first, then return here to shape automation."
                            className="max-w-sm"
                            summary="This view mirrors the arrangement timeline and exposes automation per track."
                        />
                    </Row>
                ) : (
                    tracks.map((track) => (
                        <TrackAutomationSection
                            key={track.id}
                            trackId={track.id}
                            trackName={track.name}
                            trackColor={track.color ?? 'var(--color-palette-steel)'}
                            automationMode={track.automationMode}
                            devices={track.devices.map((data) => ({ type: data.type, name: data.name }))}
                            pixelsPerBeat={pixelsPerBeat}
                            scrollX={scrollX}
                            containerWidth={containerWidth}
                        />
                    ))
                )}
            </div>
        </Stack>
    );
};

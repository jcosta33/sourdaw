import { type ReactElement } from 'react';

import { PresenceMarker } from '../components/PresenceMarker';
import { usePresence } from '../hooks/usePresence';

type PresenceOverlayProps = {
    /** Convert a beat position to pixel X offset in the timeline. */
    beatToX: (beat: number) => number;
    /** Convert a visible track ID to the center of its row in the timeline. */
    trackIdToCenterY: (trackId: string) => number | null;
};

/**
 * Renders collaborator presence indicators on top of the arrangement timeline.
 *
 * Shows:
 * - Dashed ghost playhead lines at each peer's current playhead position
 * - Solid cursor lines at each peer's mouse cursor position
 * - Name labels and track focus dots alongside cursor lines
 */
export const PresenceOverlay = ({ beatToX, trackIdToCenterY }: PresenceOverlayProps): ReactElement => {
    const presences = usePresence();

    return (
        <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
            {presences.map((presence) => {
                const playheadX = presence.playheadBeat !== null ? beatToX(presence.playheadBeat) : null;
                const cursorX = presence.cursorBeat !== null ? beatToX(presence.cursorBeat) : null;
                const trackCenterY = presence.cursorTrackId ? trackIdToCenterY(presence.cursorTrackId) : null;

                return (
                    <div key={presence.peerId}>
                        {playheadX !== null ? (
                            <PresenceMarker
                                name={presence.name}
                                color={presence.color}
                                left={playheadX}
                                variant="playhead"
                            />
                        ) : null}

                        {cursorX !== null ? (
                            <PresenceMarker
                                name={presence.name}
                                color={presence.color}
                                left={cursorX}
                                variant="cursor"
                                trackDotY={trackCenterY}
                            />
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
};

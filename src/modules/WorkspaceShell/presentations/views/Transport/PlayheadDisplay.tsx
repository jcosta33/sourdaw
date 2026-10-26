import { type ReactElement, useRef, useEffect } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import {
    playheadPositionRef,
    timeSignatureMapStore,
    transportStore,
    type TimeSignatureMapStoreState,
} from '#/modules/Transport/stores';
import { createMusicalPositionProjector, defaultTransportState } from '#/modules/Transport/useCases';

import { type TimeDisplayMode } from '../../../models/WorkspaceState';
import { toggleTimeDisplayMode } from '../../../useCases/togglePanel/panelToggles/toggleTimeDisplayMode';
import { TransportSegmentedReadout } from '../../components/Transport/TransportSegmentedReadout';
import { updateTextNode } from '../../helpers/updateTextNode';

type PlayheadDisplayProps = {
    tempo: number;
    numerator: number;
    timeDisplayMode: TimeDisplayMode;
};

const PLAYHEAD_READOUT_INTERVAL_MS = 1000 / 60;
const EMPTY_TIME_SIGNATURE_MAP: TimeSignatureMapStoreState = { changes: [] };

function getMusicalSegments(
    project: ReturnType<typeof createMusicalPositionProjector>,
    position: number
): [number, number, string] {
    const { barIndex, beatInBar } = project(position);
    const beatIndex = Math.floor(beatInBar);
    // The projector already quantizes to 480 ticks; rounding recovers that
    // integer after its tick fraction is combined with the beat index.
    const tick = Math.round((beatInBar - beatIndex) * 480);
    return [barIndex + 1, beatIndex + 1, String(tick).padStart(3, '0')];
}

/**
 * PlayheadDisplay reads playhead position from the non-reactive
 * `playheadPositionRef` via a rAF loop and writes directly to the DOM.
 * This avoids ~100 React re-renders/sec during playback.
 */
export const PlayheadDisplay = ({ tempo, timeDisplayMode }: PlayheadDisplayProps): ReactElement => {
    const isMusical = timeDisplayMode === 'musical';
    const transportState = useStore(transportStore, defaultTransportState);
    const timeSignatureMap = useStore(timeSignatureMapStore, EMPTY_TIME_SIGNATURE_MAP);
    const projectMusicalPosition = createMusicalPositionProjector({
        transport: transportState,
        tempoMap: null,
        timeSignatureMap,
    });
    const isPlaying = transportState.isPlaying;
    // The rAF loop below is gated on `isPlaying`, so it repaints every frame
    // during playback but stops entirely when paused. That means a `Stop` while
    // already paused (which resets `playheadPosition` to 0 in the store and the
    // ref) would never trigger another `updateOnce()`, leaving the readout
    // frozen at the paused beat instead of snapping back to 1.1.000. The store's
    // discrete `playheadPosition` write (seek / stop / pause) re-runs this effect
    // and forces one repaint, without re-entering the per-frame loop.
    const discretePlayheadPosition = transportState.playheadPosition;

    // Refs for direct DOM updates
    const seg1Ref = useRef<HTMLSpanElement>(null);
    const seg2Ref = useRef<HTMLSpanElement>(null);
    const seg3Ref = useRef<HTMLSpanElement>(null);
    const rafRef = useRef(0);

    // rAF loop for live updates during playback
    useEffect(() => {
        let lastReadoutUpdateAt = performance.now();
        const updateOnce = (): void => {
            const currentPosition = playheadPositionRef.current;
            if (isMusical) {
                const [bar, beat, tick] = getMusicalSegments(projectMusicalPosition, currentPosition);
                updateTextNode(seg1Ref.current, String(bar));
                updateTextNode(seg2Ref.current, String(beat));
                updateTextNode(seg3Ref.current, tick);
                return;
            }

            const seconds = currentPosition / (tempo / 60);
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            const ms = Math.floor((seconds % 1) * 1000);
            updateTextNode(seg1Ref.current, String(mins).padStart(2, '0'));
            updateTextNode(seg2Ref.current, String(secs).padStart(2, '0'));
            updateTextNode(seg3Ref.current, String(ms).padStart(3, '0'));
        };

        // Always do an initial update
        updateOnce();

        if (!isPlaying) {
            return undefined;
        }
        const loop = (frameTimestamp: number): void => {
            const elapsedSinceUpdate = frameTimestamp - lastReadoutUpdateAt;
            if (elapsedSinceUpdate >= PLAYHEAD_READOUT_INTERVAL_MS) {
                updateOnce();
                lastReadoutUpdateAt = frameTimestamp - (elapsedSinceUpdate % PLAYHEAD_READOUT_INTERVAL_MS);
            }
            rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafRef.current);
    }, [isPlaying, isMusical, projectMusicalPosition, tempo, discretePlayheadPosition]);

    // Compute initial values for SSR / first paint
    const position = playheadPositionRef.current;

    if (isMusical) {
        const segments = getMusicalSegments(projectMusicalPosition, position);

        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <TransportSegmentedReadout
                        data-testid="transport-playhead"
                        label="Bars"
                        segments={segments}
                        separators={['.', '.']}
                        segmentRefs={[seg1Ref, seg2Ref, seg3Ref]}
                        active={isPlaying}
                        onClick={toggleTimeDisplayMode}
                        ariaLabel="Playhead position — click to switch to wall-clock time"
                    />
                </TooltipTrigger>
                <TooltipContent>Click to switch to wall-clock time</TooltipContent>
            </Tooltip>
        );
    }

    const seconds = position / (tempo / 60);
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <TransportSegmentedReadout
                    label="Time"
                    segments={[
                        String(mins).padStart(2, '0'),
                        String(secs).padStart(2, '0'),
                        String(ms).padStart(3, '0'),
                    ]}
                    separators={[':', '.']}
                    segmentRefs={[seg1Ref, seg2Ref, seg3Ref]}
                    active={isPlaying}
                    onClick={toggleTimeDisplayMode}
                    ariaLabel="Playhead position — click to switch to bars and beats"
                />
            </TooltipTrigger>
            <TooltipContent>Click to switch to bars &amp; beats</TooltipContent>
        </Tooltip>
    );
};

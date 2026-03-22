import { type ReactElement, type RefObject, useState } from 'react';
import { VelocityLane } from '../automationLane/VelocityLane';
import { ProbabilityLane } from '../automationLane/ProbabilityLane';
import { PressureLane } from '../automationLane/PressureLane';
import { SlideLane } from '../automationLane/SlideLane';
import { CCLane } from '../automationLane/CCLane';
import { PitchBendLane } from '../automationLane/PitchBendLane';

type LaneMode =
    | { kind: 'velocity' }
    | { kind: 'probability' }
    | { kind: 'cc'; controller: number; label: string }
    | { kind: 'pitchBend' }
    | { kind: 'pressure' }
    | { kind: 'slide' };

const LANE_OPTIONS: { value: string; label: string; mode: LaneMode }[] = [
    { value: 'velocity', label: 'Velocity', mode: { kind: 'velocity' } },
    { value: 'probability', label: 'Probability', mode: { kind: 'probability' } },
    { value: 'pressure', label: 'Pressure', mode: { kind: 'pressure' } },
    { value: 'slide', label: 'Slide (CC74)', mode: { kind: 'slide' } },
    { value: 'cc1', label: 'CC 1 (Mod Wheel)', mode: { kind: 'cc', controller: 1, label: 'Mod Wheel' } },
    { value: 'cc7', label: 'CC 7 (Volume)', mode: { kind: 'cc', controller: 7, label: 'Volume' } },
    { value: 'cc10', label: 'CC 10 (Pan)', mode: { kind: 'cc', controller: 10, label: 'Pan' } },
    { value: 'cc11', label: 'CC 11 (Expression)', mode: { kind: 'cc', controller: 11, label: 'Expression' } },
    { value: 'cc64', label: 'CC 64 (Sustain)', mode: { kind: 'cc', controller: 64, label: 'Sustain' } },
    { value: 'pitchBend', label: 'Pitch Bend', mode: { kind: 'pitchBend' } },
];

/** Width of the piano-key gutter in PianoRoll (w-10 = 2.5rem = 40px) */
const PIANO_KEY_GUTTER = 40;

type AutomationLaneProps = {
    clipId: string | null;
    trackId: string;
    selectedNoteIds: Set<string>;
    beatWidth: number;
    contentWidth: number;
    scrollRef: RefObject<HTMLDivElement | null>;
};

export const AutomationLane = ({
    clipId,
    trackId,
    selectedNoteIds,
    beatWidth,
    contentWidth,
    scrollRef,
}: AutomationLaneProps): ReactElement => {
    const [selectedLane, setSelectedLane] = useState('velocity');

    const laneOption = LANE_OPTIONS.find((o) => o.value === selectedLane) ?? LANE_OPTIONS[0]!;
    const mode = laneOption.mode;

    const renderLane = (): ReactElement => {
        if (mode.kind === 'velocity') {
            return (
                <VelocityLane
                    clipId={clipId}
                    trackId={trackId}
                    selectedNoteIds={selectedNoteIds}
                    beatWidth={beatWidth}
                    contentWidth={contentWidth}
                />
            );
        }
        if (mode.kind === 'probability') {
            return (
                <ProbabilityLane
                    clipId={clipId}
                    trackId={trackId}
                    selectedNoteIds={selectedNoteIds}
                    beatWidth={beatWidth}
                    contentWidth={contentWidth}
                />
            );
        }
        if (mode.kind === 'pressure') {
            return (
                <PressureLane
                    clipId={clipId}
                    trackId={trackId}
                    selectedNoteIds={selectedNoteIds}
                    beatWidth={beatWidth}
                    contentWidth={contentWidth}
                />
            );
        }
        if (mode.kind === 'slide') {
            return (
                <SlideLane
                    clipId={clipId}
                    trackId={trackId}
                    selectedNoteIds={selectedNoteIds}
                    beatWidth={beatWidth}
                    contentWidth={contentWidth}
                />
            );
        }
        if (mode.kind === 'cc') {
            return <CCLane clipId={clipId} controller={mode.controller} beatWidth={beatWidth} contentWidth={contentWidth} />;
        }
        return <PitchBendLane clipId={clipId} beatWidth={beatWidth} contentWidth={contentWidth} />;
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-2 py-0.5 border-b border-border/30 bg-surface-raised shrink-0">
                <label htmlFor="lane-selector" className="text-[9px] text-muted-foreground shrink-0">
                    Lane:
                </label>
                <select
                    id="lane-selector"
                    value={selectedLane}
                    onChange={(e) => setSelectedLane(e.target.value)}
                    className="h-5 rounded border border-border/50 bg-surface-overlay px-1 text-[9px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label="Automation lane type"
                >
                    {LANE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex flex-1 min-h-0">
                {/* Piano-key gutter spacer — matches PianoRoll's w-10 column */}
                <div
                    className="shrink-0 border-r border-border/30 bg-surface-raised"
                    style={{ width: PIANO_KEY_GUTTER }}
                />
                {/* Scrollable lane area — synced to PianoRoll scroll */}
                <div
                    ref={scrollRef}
                    className="flex-1 overflow-x-auto overflow-y-hidden"
                    style={{ scrollbarWidth: 'none' }}
                >
                    <div style={{ width: contentWidth, height: '100%' }}>{renderLane()}</div>
                </div>
            </div>
        </div>
    );
};

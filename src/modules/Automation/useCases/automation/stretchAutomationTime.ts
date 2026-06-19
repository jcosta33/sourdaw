import { automationStore } from '../../stores/automationStore';

export function stretchAutomationTime(laneId: string, factor: number, anchorBeat?: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            // Anchor the stretch to the clip range. Without an explicit anchor a
            // clip lane must pivot on its own start (its earliest point), not the
            // timeline origin — otherwise factor != 1 slides the whole curve off
            // the audio it rides. Fall back to 0 only for an empty lane.
            let effectiveAnchor = anchorBeat;
            if (effectiveAnchor === undefined) {
                let minBeat = Infinity;
                for (const param of lane.points) {
                    if (param.beat < minBeat) {
                        minBeat = param.beat;
                    }
                }
                effectiveAnchor = minBeat === Infinity ? 0 : minBeat;
            }
            const anchor = effectiveAnchor;
            return {
                ...lane,
                points: lane.points
                    .map((param) => ({
                        ...param,
                        beat: Math.max(0, anchor + (param.beat - anchor) * factor),
                    }))
                    .sort((alpha, b) => alpha.beat - b.beat),
            };
        }),
    });
}

import {
    getBarBeatAtPosition,
    getMetricalBeatsBetween,
    getPrecedingBars,
    getTimeSignatureSegmentAtBeat,
    type TimeSignatureChange,
} from '../../models/TimeSignatureMap';

type RulerGridInput = {
    changes: readonly TimeSignatureChange[];
    fromBeat: number;
    toBeat: number;
    defaultNumerator: number;
    defaultDenominator: number;
};

/** Visible physical bar pieces, including the clipped piece at the left edge.
 * A partial bar and the segment that follows it can share a bar number, so a
 * named-bar inverse cannot enumerate this grid. The meter model owns its phase.
 */
export function getTimelineRulerGrid({
    changes,
    fromBeat,
    toBeat,
    defaultNumerator,
    defaultDenominator,
}: RulerGridInput) {
    if (!Number.isFinite(fromBeat) || !Number.isFinite(toBeat) || toBeat <= fromBeat) {
        return [];
    }
    const segment = getTimeSignatureSegmentAtBeat(changes, fromBeat, defaultNumerator, defaultDenominator);
    const nominalBeats = segment.numerator * segment.beatUnit;
    if (!Number.isFinite(nominalBeats) || nominalBeats <= 0) {
        return [];
    }
    const points = getMetricalBeatsBetween(changes, fromBeat, toBeat, defaultNumerator, defaultDenominator).map(
        (beat) => ({
            beat,
            position: getBarBeatAtPosition(changes, beat, defaultNumerator, defaultDenominator),
        })
    );
    const starts = points.filter(({ position }) => position.beat === 1 && position.tick === 0).map(({ beat }) => beat);
    const beginsAtPhysicalDownbeat =
        points[0]?.beat === fromBeat && points[0].position.beat === 1 && points[0].position.tick === 0;
    if (!beginsAtPhysicalDownbeat) {
        const preceding = getPrecedingBars(changes, fromBeat, 1, defaultNumerator, defaultDenominator)[0];
        if (preceding && !starts.includes(preceding.startBeat)) {
            starts.unshift(preceding.startBeat);
        }
    }

    let pointIndex = 0;
    return starts.map((startBeat, index) => {
        const meter = getTimeSignatureSegmentAtBeat(changes, startBeat, defaultNumerator, defaultDenominator);
        const endBeat = starts[index + 1] ?? toBeat;
        let point = points[pointIndex];
        while (point && point.beat < startBeat) {
            pointIndex += 1;
            point = points[pointIndex];
        }
        const ticks = [];
        while (point && point.beat < endBeat) {
            if (point.position.beat > 1) {
                ticks.push({ beat: point.beat, index: point.position.beat - 1 });
            }
            pointIndex += 1;
            point = points[pointIndex];
        }
        return {
            startBeat,
            endBeat,
            bar: getBarBeatAtPosition(changes, startBeat, defaultNumerator, defaultDenominator).bar,
            nominalBeats: meter.numerator * meter.beatUnit,
            numerator: meter.numerator,
            ticks,
        };
    });
}

import { getTempoAtBeat } from '../models/TempoMap';
import { getBarBeatAtPosition, getTimeSignatureAtBeat } from '../models/TimeSignatureMap';
import { tempoMapStore } from '../stores/tempoMapStore';
import { timeSignatureMapStore } from '../stores/timeSignatureMapStore';
import { transportStore } from '../stores/transportStore';

export function createMusicalPositionProjector() {
    const transport = structuredClone(transportStore.value);
    const tempoChanges = structuredClone(tempoMapStore.value?.changes ?? []);
    const timeSignatureChanges = structuredClone(timeSignatureMapStore.value?.changes ?? []);
    const defaultTempo = transport?.tempo ?? 120;
    const defaultNumerator = transport?.timeSignatureNumerator ?? 4;
    const defaultDenominator = transport?.timeSignatureDenominator ?? 4;
    const loopStartPpq = transport?.loopStart ?? 0;
    const loopEndPpq = transport?.loopEnd ?? 0;
    const tempoMap = {
        defaultTempo,
        changes: tempoChanges
            .map(({ beat, tempo, curve }) => ({ beat, tempo, curve }))
            .sort((alpha, beta) => alpha.beat - beta.beat),
    };

    return (ppqPosition: number) => {
        const barBeat = getBarBeatAtPosition(timeSignatureChanges, ppqPosition, defaultNumerator, defaultDenominator);
        const timeSignature = getTimeSignatureAtBeat(
            timeSignatureChanges,
            ppqPosition,
            defaultNumerator,
            defaultDenominator
        );

        return {
            bpm: getTempoAtBeat(tempoChanges, ppqPosition, defaultTempo),
            barIndex: barBeat.bar - 1,
            beatInBar: barBeat.beat - 1 + barBeat.tick / 480,
            timeSigNum: timeSignature.numerator,
            timeSigDen: timeSignature.denominator,
            loopEnabled: loopStartPpq < loopEndPpq,
            loopStartPpq,
            loopEndPpq,
            tempoMap,
        };
    };
}

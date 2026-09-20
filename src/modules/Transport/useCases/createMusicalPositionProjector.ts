import { getTempoAtBeat } from '../models/TempoMap';
import { getBarBeatAtPosition, getTimeSignatureAtBeat } from '../models/TimeSignatureMap';
import { tempoMapStore, type TempoMapStoreState } from '../stores/tempoMapStore';
import { timeSignatureMapStore, type TimeSignatureMapStoreState } from '../stores/timeSignatureMapStore';
import { DEFAULT_TEMPO_BPM, transportStore, type TransportState } from '../stores/transportStore';

type MusicalPositionSource = {
    transport: Pick<
        TransportState,
        'tempo' | 'timeSignatureNumerator' | 'timeSignatureDenominator' | 'loopStart' | 'loopEnd'
    > | null;
    tempoMap: TempoMapStoreState | null;
    timeSignatureMap: TimeSignatureMapStoreState | null;
};

export function createMusicalPositionProjector(
    source: MusicalPositionSource = {
        transport: transportStore.value,
        tempoMap: tempoMapStore.value,
        timeSignatureMap: timeSignatureMapStore.value,
    }
) {
    const transport = structuredClone(source.transport);
    const tempoChanges = structuredClone(source.tempoMap?.changes ?? []);
    const timeSignatureChanges = structuredClone(source.timeSignatureMap?.changes ?? []);
    const defaultTempo = transport?.tempo ?? DEFAULT_TEMPO_BPM;
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

import { type AppAction } from '#/utils/handlerContract';

export function describeExactImportStemSet(action: Extract<AppAction, { type: 'importStemSet' }>): string {
    const stems = action.payload.stems
        .map((stem) => {
            let pan = 'center';
            if (stem.trackPan < 0) {
                pan = `${String(stem.trackPan)} pan`;
            } else if (stem.trackPan > 0) {
                pan = `+${String(stem.trackPan)} pan`;
            }
            return `${stem.trackName} (${stem.role}, ${String(stem.trackGain)} gain, ${pan})`;
        })
        .join(', ');
    const sourceTempos = [...new Set(action.payload.stems.map((stem) => stem.sourceTempo))];
    const tempoSource =
        sourceTempos.length === 1
            ? `every ${String(sourceTempos[0])} BPM source`
            : `sources at ${sourceTempos.map(String).join('/')} BPM`;
    return `Import ${String(action.payload.stems.length)} stems into folder "${action.payload.groupName}" at ${String(action.payload.projectTempo)} BPM: ${stems}; time-stretch ${tempoSource} to ${String(action.payload.projectTempo)} BPM`;
}

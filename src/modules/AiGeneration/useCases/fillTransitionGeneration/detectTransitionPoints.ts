import { markerStore } from '#/modules/Arrangement/stores';

type DetectTransitionPointsOutput = Array<{ beat: number; fromSection: string; toSection: string }>;

export function detectTransitionPoints(): DetectTransitionPointsOutput {
    const markers = markerStore.value;
    if (!markers) {
        return [];
    }

    const transitions: DetectTransitionPointsOutput = [];
    const sections = [...markers.sections].sort((alpha, buffer) => alpha.startBeat - buffer.startBeat);

    for (let index = 0; index < sections.length - 1; index++) {
        const current = sections[index]!;
        const next = sections[index + 1]!;
        transitions.push({
            beat: current.endBeat - 2,
            fromSection: current.name,
            toSection: next.name,
        });
    }

    return transitions;
}

import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

type ReplaceTimeSignatureMapInput = {
    changes: Array<{
        beat: number;
        numerator: number;
        denominator: number;
    }>;
};

export function replaceTimeSignatureMap(input: ReplaceTimeSignatureMapInput): void {
    const changes = input.changes.map((change) => ({
        id: `ts-${crypto.randomUUID().slice(0, 8)}`,
        beat: change.beat,
        numerator: change.numerator,
        denominator: change.denominator,
    }));

    timeSignatureMapStore.set({ changes });
}

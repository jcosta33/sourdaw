import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

type ReplaceTimeSignatureMapInput = {
    changes: Array<{
        beat: number;
        numerator: number;
        denominator: number;
    }>;
};

export function replaceTimeSignatureMap(input: ReplaceTimeSignatureMapInput): void {
    for (const change of input.changes) {
        if (!Number.isFinite(change.beat) || change.beat < 0) {
            throw new RangeError('Time-signature-map beat must be finite and non-negative');
        }
        if (!Number.isInteger(change.numerator) || change.numerator < 1 || change.numerator > 32) {
            throw new RangeError('Time-signature numerator must be an integer between 1 and 32');
        }
        if (!Number.isInteger(change.denominator) || change.denominator < 1 || change.denominator > 32) {
            throw new RangeError('Time-signature denominator must be an integer between 1 and 32');
        }
    }

    const changes = input.changes.map((change) => ({
        id: `ts-${crypto.randomUUID().slice(0, 8)}`,
        beat: change.beat,
        numerator: change.numerator,
        denominator: change.denominator,
    }));

    timeSignatureMapStore.set({ changes });
}

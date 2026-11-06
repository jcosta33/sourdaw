import { afterEach, describe, expect, it, vi } from 'vitest';

import { grinderNeuralProfileParams } from '../../models/GrinderNeuralProfileParams';
import { parseGrinderNamFile } from '../../services/parseGrinderNamFile';
import { grinderNeuralLibraryStore, DEFAULT_GRINDER_NEURAL_LIBRARY_STATE } from '../grinderNeuralLibraryStore';
import { readGrinderNeuralModelContent } from '../readGrinderNeuralModelContent';

const document = {
    architecture: 'Linear',
    version: '0.5.4',
    sample_rate: 48000,
    config: { receptive_field: 2, bias: false },
    weights: [0.25, -0.5],
};

function importedEntry() {
    return parseGrinderNamFile({ file_name: 'test.nam', file_text: JSON.stringify(document) });
}

function savedValues(entry: ReturnType<typeof importedEntry>) {
    return { neuralModelMode: 1, ...Object.fromEntries(grinderNeuralProfileParams(entry.profile)) };
}

describe('readGrinderNeuralModelContent', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        grinderNeuralLibraryStore.set(DEFAULT_GRINDER_NEURAL_LIBRARY_STATE);
    });

    it('resolves an unopened saved record to all actual model weights and keeps its snapshot immutable', () => {
        const entry = importedEntry();
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, hydrated: true, entries: [entry] });
        const values = savedValues(entry);
        const captured = readGrinderNeuralModelContent(values);
        expect(captured).toBeDefined();
        expect(JSON.parse(captured!)).toEqual(document);
        grinderNeuralLibraryStore.set(DEFAULT_GRINDER_NEURAL_LIBRARY_STATE);
        expect(JSON.parse(captured!).weights).toEqual([0.25, -0.5]);
        expect(() => readGrinderNeuralModelContent(values)).toThrow(
            'Imported Grinder NAM content is unavailable in the neural library'
        );
    });

    it('does not label a legacy scalar-only profile or factory slot as a full network', () => {
        expect(readGrinderNeuralModelContent({ neuralModelMode: 0 })).toBeUndefined();
        expect(readGrinderNeuralModelContent({ neuralModelMode: 1, neuralCustomInputDrive: 1 })).toBeUndefined();
    });

    it('preserves scalar-only matching to a full library model for legacy saved profiles', () => {
        const entry = importedEntry();
        const values = {
            neuralModelMode: 1,
            ...Object.fromEntries(
                grinderNeuralProfileParams(entry.profile).filter(
                    ([name]) => !name.startsWith('neuralCustomModelDigest')
                )
            ),
        };
        expect(readGrinderNeuralModelContent(values)).toBeUndefined();
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, entries: [entry] });
        expect(JSON.parse(readGrinderNeuralModelContent(values)!)).toEqual(document);
    });

    it('allows identical content under one digest but refuses differing or missing content', () => {
        const entry = importedEntry();
        const duplicate = { ...entry, id: 'duplicate' };
        const values = savedValues(entry);
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, entries: [entry, duplicate] });
        expect(JSON.parse(readGrinderNeuralModelContent(values)!)).toEqual(document);

        const different = importedEntry();
        different.profile.model = { ...different.profile.model!, weights: [0.5, -0.5] };
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, entries: [entry, different] });
        expect(() => readGrinderNeuralModelContent(values)).toThrow(
            'Imported Grinder NAM identity is ambiguous in the neural library'
        );

        const missing = { ...entry, profile: { ...entry.profile, model: null } };
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, entries: [entry, missing] });
        expect(() => readGrinderNeuralModelContent(values)).toThrow(
            'Imported Grinder NAM identity is ambiguous in the neural library'
        );
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, entries: [missing, entry] });
        expect(() => readGrinderNeuralModelContent(values)).toThrow(
            'Imported Grinder NAM content is unavailable in the neural library'
        );
    });

    it('never publishes state or allocates request identity on successful or refused reads', () => {
        const entry = importedEntry();
        const values = savedValues(entry);
        const state = { ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, entries: [entry] };
        const original = structuredClone({ values, state });
        grinderNeuralLibraryStore.set(state);
        const publish = vi.fn();
        const unsubscribe = grinderNeuralLibraryStore.subscribe(publish);
        const uuid = vi.spyOn(crypto, 'randomUUID');
        try {
            expect(JSON.parse(readGrinderNeuralModelContent(values)!)).toEqual(document);
            expect(() => readGrinderNeuralModelContent({ neuralModelMode: 1, neuralCustomModelDigest0: 1 })).toThrow(
                'Imported Grinder NAM content is unavailable in the neural library'
            );
            expect({ values, state }).toEqual(original);
            expect(grinderNeuralLibraryStore.value).toBe(state);
            expect(publish).not.toHaveBeenCalled();
            expect(uuid).not.toHaveBeenCalled();
        } finally {
            unsubscribe();
        }
    });

    it('reads validated UTF-8 content independently of a native transport byte limit', () => {
        // Both NAM parsers read the required Linear fields and preserve additional config content.
        const content = {
            ...document,
            config: { ...document.config, description: 'é'.repeat(524_288) },
        };
        const entry = parseGrinderNamFile({ file_name: 'large.nam', file_text: JSON.stringify(content) });
        grinderNeuralLibraryStore.set({ ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE, entries: [entry] });
        const modelJson = readGrinderNeuralModelContent(savedValues(entry));
        expect(modelJson).toBeDefined();
        expect(new TextEncoder().encode(modelJson).byteLength).toBeGreaterThan(1_048_576);
        expect(JSON.parse(modelJson!)).toEqual(content);
    });
});

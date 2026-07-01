type GrinderNeuralModelPickerOptions = {
    multiple: true;
    filters: Array<{ name: string; extensions: string[] }>;
};

type PickGrinderNeuralModelFilesInput = {
    pick_files: (options: GrinderNeuralModelPickerOptions) => Promise<File[] | null>;
};

type PickGrinderNeuralModelFilesOutput = Promise<File[] | null>;

export function pickGrinderNeuralModelFiles(
    input: PickGrinderNeuralModelFilesInput
): PickGrinderNeuralModelFilesOutput {
    return input.pick_files({
        multiple: true,
        filters: [{ name: 'Neural captures', extensions: ['nam', 'json'] }],
    });
}

import { pickFiles } from '#/modules/Project/useCases';

export function pickGrinderNeuralModelFiles(): Promise<File[] | null> {
    return pickFiles({
        multiple: true,
        filters: [{ name: 'Neural captures', extensions: ['nam', 'json'] }],
    });
}

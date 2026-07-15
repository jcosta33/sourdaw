export type ModelPath = {
    family: string;
    modelId: string;
};

export function toOpfsPath({ family, modelId }: ModelPath): string {
    return `${family}/${modelId}`;
}

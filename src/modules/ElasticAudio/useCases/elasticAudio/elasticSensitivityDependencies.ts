export const elasticSensitivityDependencies: { captureRootIdentity: (() => string) | null } = {
    captureRootIdentity: null,
};

export function setElasticSensitivityRootIdentityCapture(capture: (() => string) | null): void {
    elasticSensitivityDependencies.captureRootIdentity = capture;
}

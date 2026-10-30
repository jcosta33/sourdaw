let captureRootIdentity: (() => string) | null = null;

export function setElasticSensitivityRootIdentityCapture(capture: (() => string) | null): void {
    captureRootIdentity = capture;
}

export function getElasticSensitivityRootIdentityCapture(): (() => string) | null {
    return captureRootIdentity;
}

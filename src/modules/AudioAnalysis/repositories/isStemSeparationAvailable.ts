import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

export function isStemSeparationAvailable(): boolean {
    return MODEL_RELEASE_ADMISSION.stemSeparation;
}

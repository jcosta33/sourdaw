import { updateCrustMeters } from '../stores/crustStore';

export function resetCrustTruePeakIndicator(): void {
    updateCrustMeters({ truepeakMax: -100, truepeakExceeded: false });
}

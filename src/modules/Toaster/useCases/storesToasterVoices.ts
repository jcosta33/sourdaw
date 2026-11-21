/** True for the device type whose stored state records Toaster's per-pad voices. */
export function storesToasterVoices(deviceType: string): boolean {
    return deviceType === 'toaster';
}

/** How an instrument whose module calibrates key velocity turns a played velocity into its level. */
type VelocityCalibration = {
    /**
     * The calibrated level for a 0..127 velocity played on the device, or
     * `null` when the device holds no calibration; the caller then plays the
     * velocity uncalibrated.
     */
    calibratedVelocity: (deviceId: string, velocity: number) => number | null;
};

let registeredCalibration: VelocityCalibration | null = null;

/**
 * MIDI may not import a device module, so the composition root
 * (`#/app/registerDeviceEnginePorts`) fills this once at boot, before any
 * MIDI input can reach an instrument.
 */
export const velocityCalibration = {
    /**
     * Registering the identical calibration again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(calibration: VelocityCalibration): void {
        if (registeredCalibration === null) {
            registeredCalibration = calibration;
            return;
        }
        if (registeredCalibration.calibratedVelocity !== calibration.calibratedVelocity) {
            throw new Error('velocityCalibration.configure: the calibration differs from the registered one');
        }
    },
    /**
     * The registered calibration. Reading before registration throws rather
     * than answering `null`: that would silently ignore the curve a musician
     * calibrated their keyboard to.
     */
    read(caller: string): VelocityCalibration {
        if (registeredCalibration === null) {
            throw new Error(
                `${caller}: velocity calibration is not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredCalibration;
    },
};

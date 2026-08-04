const PROJECT_PARAMETER_ID_OVERRIDES: Readonly<Record<string, string>> = {
    humanize_amount: 'humanize',
};

/** Keep project parameter identity stable while the DSP boundary uses snake case. */
export function getLevainProjectParameterId(engineParameterName: string): string {
    const override = PROJECT_PARAMETER_ID_OVERRIDES[engineParameterName];
    if (override) {
        return override;
    }
    return engineParameterName.replaceAll(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase());
}

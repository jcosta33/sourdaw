export type AutomationParameterRangeResolver = (input: {
    trackId: string;
    parameterTargetId: string;
}) => { minValue: number; maxValue: number } | null;

let registeredResolver: AutomationParameterRangeResolver | null = null;

/** Stores the implementation; a later fill replaces an earlier one. */
export function setAutomationParameterRangeResolver(resolver: AutomationParameterRangeResolver): void {
    registeredResolver = resolver;
}

/**
 * The registered resolver. Reading before registration throws; a resolver that
 * answers `null` for a parameter with no declared range stays a real answer.
 */
export const automationParameterRangePort = {
    read(): AutomationParameterRangeResolver {
        if (registeredResolver === null) {
            throw new Error(
                'automationParameterRangePort.read: the automation parameter range resolver is not registered; call setAutomationParameterRangeResolver() from #/app/bootstrap (bootstrap does this)'
            );
        }
        return registeredResolver;
    },
};

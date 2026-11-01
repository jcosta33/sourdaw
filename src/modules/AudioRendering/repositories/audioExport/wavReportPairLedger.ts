/** Pairs each completed WAV with its completed `.loudness.json` report and orders their commit. */
export function createWavReportPairLedger(required: boolean) {
    const completed = new Map<string, string>();
    const pairs = new Map<string, string>();
    const tokenOf = (name: string): string => {
        const token = completed.get(name);
        if (token === undefined) {
            throw new Error('Invalid WAV report pair.');
        }
        return token;
    };
    const assertComplete = () => {
        if (required && pairs.size * 2 !== completed.size) {
            throw new Error('WAV report pairs are incomplete.');
        }
    };
    return {
        complete(name: string, token: string) {
            completed.set(name, token);
        },
        register(audioName: string, reportName: string) {
            if (
                !required ||
                !audioName.endsWith('.wav') ||
                reportName !== `${audioName}.loudness.json` ||
                !completed.has(audioName) ||
                !completed.has(reportName) ||
                pairs.has(audioName)
            ) {
                throw new Error('Invalid WAV report pair.');
            }
            pairs.set(audioName, reportName);
        },
        assertComplete,
        commitOrder(tokens: readonly string[]): readonly string[] {
            if (!required) {
                return tokens;
            }
            assertComplete();
            // Native replacement is ordered, not atomic across the batch: publish each report before its WAV.
            return [...pairs].flatMap(([audio, report]) => [tokenOf(report), tokenOf(audio)]);
        },
    };
}

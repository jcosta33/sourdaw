type ValidateDsoTimeSignatureInput = {
    numerator: number;
    denominator: number;
};

type ValidateDsoTimeSignatureOutput = string | null;

export function validateDsoTimeSignature({
    numerator,
    denominator,
}: ValidateDsoTimeSignatureInput): ValidateDsoTimeSignatureOutput {
    if (numerator < 1 || numerator > 32) {
        return `Time signature numerator ${numerator} out of range (1-32)`;
    }
    if (![2, 4, 8, 16].includes(denominator)) {
        return `Time signature denominator ${denominator} must be one of 2, 4, 8, or 16`;
    }
    return null;
}

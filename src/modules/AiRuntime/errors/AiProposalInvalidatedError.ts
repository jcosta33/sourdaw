export class AiProposalInvalidatedError extends Error {
    constructor(message = 'The project changed after this proposal was created. Review and submit the command again.') {
        super(message);
        this.name = 'AiProposalInvalidatedError';
    }
}

export class AiProposalInvalidatedError extends Error {
    constructor() {
        super('The project changed after this proposal was created. Review and submit the command again.');
        this.name = 'AiProposalInvalidatedError';
    }
}

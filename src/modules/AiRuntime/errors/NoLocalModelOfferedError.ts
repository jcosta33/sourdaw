import { describeNoLocalModelOffered } from '../transformers/localContextWindowRefusal';

export class NoLocalModelOfferedError extends Error {
    override readonly name = 'NoLocalModelOfferedError';

    constructor() {
        super(describeNoLocalModelOffered());
    }
}

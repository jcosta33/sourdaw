import { AppError } from "#/helpers/Errors/AppError";

export class TrackNotFoundError extends AppError {
    constructor(readonly trackId: string) {
        super(`Track ${trackId} not found`);
    }
}

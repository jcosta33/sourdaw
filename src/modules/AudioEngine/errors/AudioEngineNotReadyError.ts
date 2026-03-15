import { AppError } from "#/helpers/Errors/AppError";

export class AudioEngineNotReadyError extends AppError {
    constructor() {
        super("Audio engine is not ready. User interaction may be required to start audio.");
    }
}

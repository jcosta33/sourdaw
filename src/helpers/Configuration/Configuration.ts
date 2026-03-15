/* (c) Copyright Frontify Ltd., all rights reserved. */

export class Configuration {
    readonly #configValues: Record<string, unknown>;

    constructor(...sources: Record<string, unknown>[]) {
        this.#configValues = Object.assign({}, ...sources);
    }

    static from(...sources: Record<string, unknown>[]) {
        return new Configuration(...sources);
    }

    get amplitudeApiKey(): string | null {
        return this.#getAsNullableString('amplitudeApiKey');
    }

    get amplitudeEnabled(): boolean {
        return this.#getAsBoolean('amplitudeEnabled');
    }

    get environment(): string {
        return this.#getAsString('environment');
    }

    get intercomEnabled(): boolean {
        return this.#getAsBoolean('intercomEnabled');
    }

    get intercomSettings(): object {
        return this.#getAsObject('intercomSettings');
    }

    get locales(): Record<string, string> {
        return this.#getAsObject<Record<string, string>>('locales');
    }

    get pusherCluster(): string | null {
        return this.#getAsNullableString('pusherCluster');
    }

    get pusherEnabled(): boolean {
        return this.#getAsBoolean('pusherEnabled');
    }

    get pusherKey(): string | null {
        return this.#getAsNullableString('pusherKey');
    }

    get segmentEnabled(): boolean {
        return this.#getAsBoolean('segmentEnabled');
    }

    get segmentKey(): string | null {
        return this.#getAsNullableString('segmentKey');
    }

    get sentryDsn(): string | null {
        return this.#getAsNullableString('sentryDsn');
    }

    get sentryEnabled(): boolean {
        return this.#getAsBoolean('sentryEnabled');
    }

    #getAsString(key: string): string {
        const value = this.#configValues[key] ?? null;

        if (typeof value !== 'string') {
            this.#handleError(key, value, 'string');
        }

        return value;
    }

    #getAsNullableString(key: string): string | null {
        const value = this.#configValues[key] ?? null;

        if (value !== null && typeof value !== 'string') {
            this.#handleError(key, value, 'string | null');
        }

        return value;
    }

    #getAsBoolean(key: string): boolean {
        const value = this.#configValues[key] ?? null;

        if (typeof value === 'boolean') {
            return value;
        } else if (typeof value === 'string' && /^(true|false)$/i.test(value)) {
            return value.toLowerCase() === 'true';
        }

        this.#handleError(key, value, 'boolean');
    }

    #getAsObject<TShape extends object>(key: string): TShape {
        const value = this.#configValues[key] ?? null;

        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            this.#handleError(key, value, 'object');
        }

        return value as TShape;
    }

    #handleError(key: string, value: unknown, expectedType: string): never {
        const actualType = typeof value;

        throw new TypeError(
            `Unexpected value type for key "${key}", expected \`${expectedType}\` but got \`${actualType}\`.`
        );
    }
}

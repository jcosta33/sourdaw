export class ParameterSAB {
    private sab: SharedArrayBuffer;
    private view: Float32Array;
    private parameterMap: Map<string, number>;
    private currentIndex: number;

    constructor(maxParameters: number = 1024) {
        // We use a Float32Array for continuous parameter values
        this.sab = new SharedArrayBuffer(maxParameters * Float32Array.BYTES_PER_ELEMENT);
        this.view = new Float32Array(this.sab);
        this.parameterMap = new Map();
        this.currentIndex = 0;
    }

    /**
     * Get the underlying SharedArrayBuffer to send to the AudioWorklet.
     */
    public getSAB(): SharedArrayBuffer {
        return this.sab;
    }

    /**
     * Map a parameter name to a specific index in the SAB.
     */
    public registerParameter(name: string): number {
        if (this.parameterMap.has(name)) {
            return this.parameterMap.get(name)!;
        }

        if (this.currentIndex >= this.view.length) {
            throw new Error('ParameterSAB is full. Cannot register more parameters.');
        }

        const index = this.currentIndex++;
        this.parameterMap.set(name, index);
        
        // Initialize to 0
        // Float32Array doesn't support Atomics natively for floats in JS 
        // (Atomics only works with Int8, Uint8, Int16, Uint16, Int32, Uint32).
        // However, since we're just reading/writing floats without needing strict atomic 
        // read-modify-write operations like compareExchange, a simple indexed write is lock-free 
        // and sufficient for continuous audio parameters where the latest value just wins.
        // For true atomicity with floats, we'd need to use a Uint32Array view and 
        // Float32Array bit conversions, but standard Float32Array indexing is fine for MVP.
        this.view[index] = 0.0;
        
        return index;
    }

    /**
     * Get the index for a parameter name.
     */
    public getParameterIndex(name: string): number | undefined {
        return this.parameterMap.get(name);
    }

    /**
     * Write a parameter value. (Main Thread UI -> Audio Thread)
     */
    public setParameterValue(name: string, value: number): void {
        const index = this.parameterMap.get(name);
        if (index !== undefined) {
            this.view[index] = value;
        }
    }

    /**
     * Read a parameter value. (Audio Thread -> Main Thread UI, or internal checking)
     */
    public getParameterValue(name: string): number {
        const index = this.parameterMap.get(name);
        if (index !== undefined) {
            return this.view[index] ?? 0.0;
        }
        return 0.0;
    }

    /**
     * Direct index write for maximum performance (used inside tighter loops)
     */
    public setValueAtIndex(index: number, value: number): void {
        this.view[index] = value;
    }

    /**
     * Direct index read for maximum performance
     */
    public getValueAtIndex(index: number): number {
        return this.view[index] ?? 0.0;
    }
}

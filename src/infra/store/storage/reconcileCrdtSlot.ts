type MutableContainer = { [key: string]: unknown };

type UnknownRecord = Record<string, unknown>;

/**
 * Resolves the stable identity of one row of a collection, or `null` when this
 * row has none. A collection whose rows cannot all be identified uniquely is
 * reconciled as a single opaque value instead of row by row.
 */
export type CrdtEntityIdentity = (row: UnknownRecord) => string | null;

/**
 * Per-field identity overrides, keyed by the name of the field holding the
 * collection. Collections whose rows carry no `id` need one of these to be
 * reconciled row by row; without it they are replaced whole.
 */
export type CrdtEntityIdentityByField = Readonly<Record<string, CrdtEntityIdentity>>;

export type ReconcileCrdtSlotInput = {
    /** The live Automerge draft handed in by `change()`. */
    doc: MutableContainer;
    /** The document slot this write targets. Wire format — never renamed. */
    key: string;
    /**
     * The value this write was derived from — what the writing actor last saw
     * of the document. Rows present in the document but in neither this nor
     * `value` were never visible to this actor, so it cannot have meant to
     * delete them and they are left alone.
     */
    baseValue: unknown;
    /** The value the writing actor asked to store. */
    value: unknown;
    identityByField?: CrdtEntityIdentityByField;
};

function isUnknownRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readField(source: unknown, field: string): unknown {
    if (!isUnknownRecord(source)) {
        return undefined;
    }
    return source[field];
}

/**
 * Equality for "has this value changed enough to be worth a document
 * operation". Scalars settle on identity alone; only two composite values fall
 * back to serializing, because a local write must not pay a `JSON.stringify`
 * per scalar field it touches.
 */
function isSameValue(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    const leftIsComposite = typeof left === 'object' && left !== null;
    const rightIsComposite = typeof right === 'object' && right !== null;
    if (!leftIsComposite || !rightIsComposite) {
        return false;
    }
    return JSON.stringify(left) === JSON.stringify(right);
}

function identifyById(row: UnknownRecord): string | null {
    const id = row.id;
    if (typeof id !== 'string' || id.length === 0) {
        return null;
    }
    return id;
}

/**
 * Every row's identity in order, or `null` when the collection cannot be keyed
 * — a row that is not a record, a row with no identity, or a duplicated
 * identity. A `null` here is what routes primitive arrays, positional arrays
 * (tuning tables, pitch curves, step patterns) and id-less value rows to a
 * whole-value replace, which is the correct treatment for a collection that is
 * one logical value rather than a set of independently editable entities.
 */
function identifyRows(rows: readonly unknown[], identify: CrdtEntityIdentity): readonly string[] | null {
    const identities: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        if (!isUnknownRecord(row)) {
            return null;
        }
        const identity = identify(row);
        if (identity === null || seen.has(identity)) {
            return null;
        }
        seen.add(identity);
        identities.push(identity);
    }
    return identities;
}

function indexOfIdentity(rows: readonly unknown[], identify: CrdtEntityIdentity, identity: string): number {
    for (const [index, row] of rows.entries()) {
        if (isUnknownRecord(row) && identify(row) === identity) {
            return index;
        }
    }
    return -1;
}

function identityAt(rows: readonly unknown[], identify: CrdtEntityIdentity, index: number): string | null {
    const row = rows[index];
    if (!isUnknownRecord(row)) {
        return null;
    }
    return identify(row);
}

type ReconcileChildInput = {
    container: MutableContainer | unknown[];
    field: string | number;
    fieldName: string;
    base: unknown;
    desired: unknown;
    identityByField: CrdtEntityIdentityByField;
};

/**
 * A collection is addressed by numeric index and a map by string key; the two
 * never cross. Keeping the pairing in the narrowing rather than in a cast means
 * a mismatch is a type error at the call site instead of a silent write to the
 * wrong shape.
 */
function writeChild(container: MutableContainer | unknown[], field: string | number, value: unknown): void {
    if (Array.isArray(container) && typeof field === 'number') {
        container[field] = value;
        return;
    }
    if (!Array.isArray(container) && typeof field === 'string') {
        container[field] = value;
        return;
    }
    throw new Error('CRDT slot reconciliation addressed a container with the wrong key kind');
}

function readChild(container: MutableContainer | unknown[], field: string | number): unknown {
    if (Array.isArray(container) && typeof field === 'number') {
        return container[field];
    }
    if (!Array.isArray(container) && typeof field === 'string') {
        return container[field];
    }
    throw new Error('CRDT slot reconciliation addressed a container with the wrong key kind');
}

function reconcileChild(input: ReconcileChildInput): void {
    const { container, field, fieldName, base, desired, identityByField } = input;
    const current = readChild(container, field);

    if (isUnknownRecord(desired) && isUnknownRecord(current)) {
        reconcileRecord({ target: current, base, desired, identityByField });
        return;
    }

    if (Array.isArray(desired) && Array.isArray(current)) {
        reconcileCollection({ container, field, fieldName, current, base, desired, identityByField });
        return;
    }

    if (isSameValue(current, desired)) {
        return;
    }

    writeChild(container, field, desired);
}

type ReconcileRecordInput = {
    target: UnknownRecord;
    base: unknown;
    desired: UnknownRecord;
    identityByField: CrdtEntityIdentityByField;
};

function reconcileRecord(input: ReconcileRecordInput): void {
    const { target, base, desired, identityByField } = input;

    for (const [field, desiredField] of Object.entries(desired)) {
        reconcileChild({
            container: target,
            field,
            fieldName: field,
            base: readField(base, field),
            desired: desiredField,
            identityByField,
        });
    }

    for (const field of Object.keys(target)) {
        if (Object.hasOwn(desired, field)) {
            continue;
        }
        // Only a field this actor actually saw can have been removed by it. A
        // field it never saw belongs to another actor's concurrent write, or
        // to content this build's projection could not read, and dropping it
        // here would delete it for every peer.
        if (!isUnknownRecord(base) || !Object.hasOwn(base, field)) {
            continue;
        }
        delete target[field];
    }
}

type ReconcileCollectionInput = {
    container: MutableContainer | unknown[];
    field: string | number;
    fieldName: string;
    current: unknown[];
    base: unknown;
    desired: readonly unknown[];
    identityByField: CrdtEntityIdentityByField;
};

function reconcileCollection(input: ReconcileCollectionInput): void {
    const { container, field, fieldName, current, base, desired, identityByField } = input;
    const identify = identityByField[fieldName] ?? identifyById;

    const desiredIdentities = identifyRows(desired, identify);
    const currentIdentities = identifyRows(current, identify);
    if (desiredIdentities === null || currentIdentities === null) {
        if (isSameValue(current, desired)) {
            return;
        }
        writeChild(container, field, desired);
        return;
    }

    const baseIdentities = Array.isArray(base) ? identifyRows(base, identify) : null;
    const baseIdentitySet = new Set(baseIdentities ?? []);
    const desiredIdentitySet = new Set(desiredIdentities);
    const baseRowByIdentity = new Map<string, unknown>();
    if (Array.isArray(base) && baseIdentities) {
        for (const [index, identity] of baseIdentities.entries()) {
            baseRowByIdentity.set(identity, base[index]);
        }
    }

    // Rows this actor saw and then dropped are genuine deletions. Rows it never
    // saw are another actor's, or content its own projection rejected, and are
    // preserved — this is what stops one ordinary edit from wiping a row the
    // writer never had in hand.
    for (let index = current.length - 1; index >= 0; index -= 1) {
        const identity = currentIdentities[index];
        if (identity === undefined || desiredIdentitySet.has(identity)) {
            continue;
        }
        if (!baseIdentitySet.has(identity)) {
            continue;
        }
        current.splice(index, 1);
    }

    // Index once rather than scanning the collection per desired row. This runs
    // on every slot write in the application, and nested collections compound.
    const currentIndexByIdentity = indexCollection(current, identify);

    for (const [desiredIndex, identity] of desiredIdentities.entries()) {
        const currentIndex = currentIndexByIdentity.get(identity);
        if (currentIndex === undefined) {
            continue;
        }
        reconcileChild({
            container: current,
            field: currentIndex,
            fieldName,
            base: baseRowByIdentity.get(identity),
            desired: desired[desiredIndex],
            identityByField,
        });
    }

    placeRows({
        current,
        identify,
        desired,
        desiredIdentities,
        currentIndexByIdentity,
        desiredIdentitySet,
    });
}

function indexCollection(rows: readonly unknown[], identify: CrdtEntityIdentity): Map<string, number> {
    const indexByIdentity = new Map<string, number>();
    for (const [index, row] of rows.entries()) {
        if (!isUnknownRecord(row)) {
            continue;
        }
        const identity = identify(row);
        if (identity !== null) {
            indexByIdentity.set(identity, index);
        }
    }
    return indexByIdentity;
}

/**
 * Indices of a longest strictly increasing subsequence of `values`.
 *
 * Used to pick the largest set of rows already in the writer's intended
 * relative order, so a reorder moves the fewest elements it possibly can.
 */
function longestIncreasingRun(values: readonly number[]): readonly number[] {
    const tails: number[] = [];
    const previous: number[] = Array.from({ length: values.length }, () => -1);
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index] ?? 0;
        let low = 0;
        let high = tails.length;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            const candidate = values[tails[mid] ?? 0] ?? 0;
            if (candidate < value) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        if (low > 0) {
            previous[index] = tails[low - 1] ?? -1;
        }
        tails[low] = index;
    }

    const run: number[] = [];
    let cursor = tails.length > 0 ? (tails[tails.length - 1] ?? -1) : -1;
    while (cursor >= 0) {
        run.push(cursor);
        cursor = previous[cursor] ?? -1;
    }
    return run.reverse();
}

type PlaceRowsInput = {
    current: unknown[];
    identify: CrdtEntityIdentity;
    desired: readonly unknown[];
    desiredIdentities: readonly string[];
    currentIndexByIdentity: ReadonlyMap<string, number>;
    desiredIdentitySet: ReadonlySet<string>;
};

/**
 * Insert rows the document lacks, and apply the writer's ordering by moving as
 * few existing rows as possible.
 *
 * Ordering is load-bearing in several slots — device and MIDI-FX chains,
 * beat-sorted tempo and time-signature maps — so a local reorder has to reach
 * the document. Automerge resolves concurrent list operations by element
 * identity and offers no move primitive, so the only way to relocate a row is
 * to remove it and insert it again, which necessarily mints a new element and
 * discards a peer's concurrent edit to *that* row.
 *
 * Writing the writer's own row value into each displaced position instead is
 * strictly worse: it competes with a peer's concurrent field write on whatever
 * element already occupies that position and resolves last-writer-wins, so
 * moving one row to the front silently discarded concurrent edits to every row
 * it pushed along. One user dragging a device up the chain would drop another
 * user's knob tweak on a device that never moved.
 *
 * So the rows already in the writer's intended relative order are pinned, and
 * only the genuine movers are removed and re-inserted. The blast radius of a
 * reorder is then exactly the rows the user actually moved.
 */
function placeRows(input: PlaceRowsInput): void {
    const { current, identify, desired, desiredIdentities, currentIndexByIdentity, desiredIdentitySet } = input;

    const presentDesiredIndices: number[] = [];
    for (const [desiredIndex, identity] of desiredIdentities.entries()) {
        if (currentIndexByIdentity.has(identity)) {
            presentDesiredIndices.push(desiredIndex);
        }
    }

    // Rank each present row by where it currently sits; the longest increasing
    // run over those positions is the largest set already correctly ordered.
    const currentPositions = presentDesiredIndices.map(
        (desiredIndex) => currentIndexByIdentity.get(desiredIdentities[desiredIndex] ?? '') ?? 0
    );
    const pinned = new Set<string>();
    for (const runIndex of longestIncreasingRun(currentPositions)) {
        const desiredIndex = presentDesiredIndices[runIndex];
        if (desiredIndex === undefined) {
            continue;
        }
        const identity = desiredIdentities[desiredIndex];
        if (identity !== undefined) {
            pinned.add(identity);
        }
    }

    // Remove only the writer's own rows that have to move. Pinned rows keep
    // their element, and with it any concurrent edit a peer is making to them.
    // A row the writer never had in hand is not its to relocate, so it stays
    // exactly where it is.
    for (let index = current.length - 1; index >= 0; index -= 1) {
        const identity = identityAt(current, identify, index);
        if (identity === null || pinned.has(identity)) {
            continue;
        }
        if (!desiredIdentitySet.has(identity)) {
            continue;
        }
        current.splice(index, 1);
    }

    // Walk the writer's order, placing anything not already positioned right
    // after the previously placed row.
    let previousIndex = -1;
    for (const [desiredIndex, identity] of desiredIdentities.entries()) {
        if (pinned.has(identity)) {
            previousIndex = indexOfIdentity(current, identify, identity);
            continue;
        }
        const insertAt = Math.min(previousIndex + 1, current.length);
        current.splice(insertAt, 0, desired[desiredIndex]);
        previousIndex = insertAt;
    }
}

/**
 * Apply a store's value to its document slot as the rows it actually changed,
 * rather than as a replacement of the whole slot.
 *
 * A whole-slot assignment tells Automerge "one actor rewrote this entire
 * collection" when the truth is "one row changed". Two peers editing different
 * rows of the same slot then destroy each other's edit on merge, on the same
 * build, with no sanitizer and no version skew involved. Reconciling in place
 * expresses each write as the operations it really is, so concurrent edits to
 * distinct rows converge.
 *
 * Three inputs, not two: the document holds rows the writer may never have
 * seen — inserted concurrently by a peer, or rejected by this build's own
 * projection and therefore missing from the value it wrote back. Deletion is
 * inferred from `baseValue`, the value this write was derived from, so only a
 * row the writer actually had in hand can be removed by it.
 *
 * Collections whose rows carry no stable identity are replaced whole. That is
 * deliberate: a tuning table, a pitch curve and a step pattern are one logical
 * value indexed by position, not a set of independently editable entities, and
 * keying them by position would merge two peers' unrelated edits into a value
 * neither wrote.
 */
export function reconcileCrdtSlot(input: ReconcileCrdtSlotInput): void {
    const { doc, key, baseValue, value, identityByField = {} } = input;
    reconcileChild({
        container: doc,
        field: key,
        fieldName: key,
        base: baseValue,
        desired: value,
        identityByField,
    });
}

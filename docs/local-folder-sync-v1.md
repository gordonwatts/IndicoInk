# Local-folder sync protocol, version 1

This document specifies a future protocol for sharing annotation changes through a user-selected folder that another machine or a folder-sync provider can copy. It is a wire-format and merge contract only; it does not add sync code or change the app's current local persistence.

## Scope and trust boundary

Version 1 synchronizes only user-authored slide annotations: pen strokes and text notes. The local main-process SQLite store remains authoritative for each installation. The shared folder contains protocol JSON files only; it never contains SQLite databases, database journals, PDF bytes, credentials or API keys, undo/redo history, view state, or cached Indico responses. Each device applies validated changes to its own local store through the existing main-process boundary.

The protocol assumes an eventually copied folder, not a transactional or trusted database. Readers tolerate files arriving late or out of order. Files are immutable after publication, except that a writer may replace its own uniquely named temporary file before publishing it. A missing file is not evidence of deletion. A malformed, unsupported, or conflicting file is preserved and ignored while the device reports a local sync error; readers never repair or delete another device's files.

## Folder layout and JSON records

All JSON is UTF-8, one JSON object per file, with no comments or trailing commas. Integers are base-10 JSON numbers. UUIDs are lowercase canonical UUID strings. Property names and required/optional fields below are exact. Unknown fields and unsupported versions are not interpreted as version 1.

```text
<shared-folder>/
  workspace.json
  operations/<deviceId>/<sequence>.json
  checkpoints/<deviceId>/<checkpointSequence>.json
```

`workspace.json` is created once and never overwritten:

```json
{
  "format": "indicoink-folder-sync",
  "version": 1,
  "workspaceId": "9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d"
}
```

Its exact schema is `{ format: "indicoink-folder-sync", version: 1, workspaceId: UUID }`. A workspace ID is generated independently of conference IDs. If an existing file is invalid, has another format/version, or its workspace ID differs from the device's locally paired workspace, sync fails closed; it must not be silently replaced.

An operation is immutable and its filename is `<deviceId>/<sequence>.json`. `operationId` is the canonical `${deviceId}:${sequence}` string. `context` is a vector clock: a map from device UUID to the greatest contiguous operation sequence from that device that this writer had incorporated before making this operation. Zero entries are omitted. The writer's own entry, when present, is exactly `sequence - 1`.

Common operation fields are exactly:

```json
{
  "format": "indicoink-operation",
  "version": 1,
  "workspaceId": "9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d",
  "deviceId": "72fc257a-40d2-4b19-ae71-b2a02f4fe5e6",
  "sequence": 12,
  "operationId": "72fc257a-40d2-4b19-ae71-b2a02f4fe5e6:12",
  "context": {
    "72fc257a-40d2-4b19-ae71-b2a02f4fe5e6": 11,
    "639be5ee-82ea-4a08-93a9-afc608990bdc": 4
  },
  "kind": "put",
  "annotation": {
    "kind": "stroke",
    "id": "stroke-uuid",
    "conferenceId": "conference-id",
    "talkId": "talk-id",
    "deckId": "deck-id",
    "slideId": "slide-id",
    "createdAt": 1781631000000,
    "updatedAt": 1781631000000,
    "baseWidth": 2,
    "color": "#000000",
    "points": [
      { "x": 0.125, "y": 0.25, "pressure": 0.5, "time": 10 },
      { "x": 0.2, "y": 0.3, "pressure": 0.75, "time": 27 }
    ]
  }
}
```

Exact operation schema:

- Every operation requires `format`, `version`, `workspaceId`, `deviceId`, `sequence`, `operationId`, `context`, and `kind`. A `put` additionally requires `annotation`; an `erase` additionally requires `target`; a `noop` has neither.
- `format` is the literal `indicoink-operation`; `version` is integer `1`; workspace and device IDs are UUIDs; `sequence` is a positive safe integer; `operationId` must equal `${deviceId}:${sequence}`.
- `context` is an object whose keys are device UUIDs and whose values are positive safe integers. It cannot claim a sequence that the writer has not received contiguously. Its own-device entry, if present, must equal `sequence - 1`.
- `kind` is exactly `put`, `erase`, or `noop`. A `put` contains the complete annotation value below and no `target`. An `erase` has no `annotation` property and targets the same annotation identity using the required locator fields:

```json
{
  "format": "indicoink-operation",
  "version": 1,
  "workspaceId": "9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d",
  "deviceId": "72fc257a-40d2-4b19-ae71-b2a02f4fe5e6",
  "sequence": 13,
  "operationId": "72fc257a-40d2-4b19-ae71-b2a02f4fe5e6:13",
  "context": {
    "72fc257a-40d2-4b19-ae71-b2a02f4fe5e6": 12,
    "639be5ee-82ea-4a08-93a9-afc608990bdc": 4
  },
  "kind": "erase",
  "target": {
    "conferenceId": "conference-id",
    "talkId": "talk-id",
    "deckId": "deck-id",
    "slideId": "slide-id",
    "annotationId": "stroke-uuid"
  }
}
```

An erase requires `target` with exactly the five non-empty string fields shown, and must not contain `annotation`. A put's target identity is taken from its annotation's `conferenceId`, `talkId`, `deckId`, `slideId`, and `id`.

A `noop` has no `annotation` or `target` property and advances only its writer's operation sequence. It has no annotation effect. It is used only to close a sequence reservation whose original operation cannot be recovered:

```json
{
  "format": "indicoink-operation",
  "version": 1,
  "workspaceId": "9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d",
  "deviceId": "72fc257a-40d2-4b19-ae71-b2a02f4fe5e6",
  "sequence": 14,
  "operationId": "72fc257a-40d2-4b19-ae71-b2a02f4fe5e6:14",
  "context": {
    "72fc257a-40d2-4b19-ae71-b2a02f4fe5e6": 13,
    "639be5ee-82ea-4a08-93a9-afc608990bdc": 4
  },
  "kind": "noop"
}
```

Annotation values are the existing persisted models, with protocol `kind` added as a discriminator. A stroke requires `kind: "stroke"`, `id`, `conferenceId`, `talkId`, `deckId`, `slideId`, integer `createdAt` and `updatedAt` epoch milliseconds, and `points`. It may contain numeric `baseWidth` and string `color`. Each point has exactly numeric `x`, `y`, `pressure`, and `time`; `x` and `y` are normalized page coordinates. A text note requires `kind: "text"`, the same identity/timestamp fields, numeric `x` and `y`, and string `text`; it may contain numeric `width`. Version 1 carries no other annotation fields. IDs and parent IDs must match the local conference/talk/deck/slide relation before applying. The annotation's `createdAt`/`updatedAt` values are payload data, not conflict-ordering clocks.

A checkpoint is an immutable processing-progress hint. Its filename is `<deviceId>/<checkpointSequence>.json`; `checkpointSequence` increases per checkpoint writer. `seen` has the same vector-clock shape as `context` and means the writer has validated and incorporated every operation through each listed contiguous sequence, including causal dependencies. Checkpoints do not replace operations, encode annotation contents, or authorize deletion.

```json
{
  "format": "indicoink-checkpoint",
  "version": 1,
  "workspaceId": "9b9e7cb4-8335-4a1a-9f4d-04a5986cc02d",
  "deviceId": "72fc257a-40d2-4b19-ae71-b2a02f4fe5e6",
  "checkpointSequence": 3,
  "seen": {
    "72fc257a-40d2-4b19-ae71-b2a02f4fe5e6": 13,
    "639be5ee-82ea-4a08-93a9-afc608990bdc": 4
  }
}
```

Its exact schema is `{ format: "indicoink-checkpoint", version: 1, workspaceId: UUID, deviceId: UUID, checkpointSequence: positive safe integer, seen: { [device UUID]: positive safe integer } }`. A checkpoint is advisory only: a reader still checks available operation files, gaps, and causal dependencies. It never assumes operations below `seen` are safe to remove.

## Causal application and checkpoints

Each device has a stable random device ID and a durable local sequence reservation. It reserves the next sequence before constructing an operation and never reserves a later sequence while an earlier reservation is unresolved. On restart, it resolves that reservation before issuing another: if the final path already exists, it validates the file as the reserved operation and replays or recognizes its effect before marking the reservation complete; otherwise it recovers the operation from durable local state or a complete temporary file and publishes those exact bytes. If neither a recoverable operation nor a final file exists, it publishes a `noop` for that reserved sequence before advancing. An invalid final file, identity mismatch, or disagreement with recovered bytes is corruption/collision; the device preserves the evidence, reports the error, and does not advance. It must never skip a reservation: readers apply only contiguous sequences, so a hole would permanently block that device's later operations and checkpoints.

To publish, the writer serializes the complete operation to a uniquely named temporary file in the same directory, flushes and closes it, then uses an atomic **no-clobber** publish primitive (for example, rename-with-no-replace) to create the final path only if it is absent. A plain rename that may replace an existing destination is not sufficient. If the filesystem cannot provide atomic no-clobber publication, the writer must refuse to use that folder. After publication, it reopens the final file and byte-compares it with the serialized operation. If the path already existed or the comparison differs, it reads and verifies the existing bytes: identical bytes make the retry idempotent; different bytes indicate a device-ID collision, so the device stops writing and preserves both records for diagnosis. A device restored from backup must re-enroll with a new device ID if its counter may have gone backwards.

Readers validate format, version, workspace, filename/identity agreement, payload shape, and parent references. They wait on sequence gaps and causal dependencies rather than advancing past them. Duplicate operation IDs with identical contents are idempotent. Two contents for one operation ID are corruption/collision and are not resolved by timestamps. A new operation's context may include only contiguous operations already incorporated by that device.

Operation A (`deviceId = d`, `sequence = n`) happens before operation B exactly when B's `context[d] >= n`. If neither operation happens before the other, they are concurrent. Wall-clock time, file modification time, directory order, and `createdAt`/`updatedAt` never break ties. For one annotation, discard an operation from the visible frontier only when a later operation causally observes it. One remaining `put` is the current value; one remaining `erase` is deleted. Multiple concurrent frontier values are a conflict and must remain recoverable. In particular, a concurrent erase and put is not silently treated as either deletion or resurrection. A user resolution emits a new operation whose context includes every conflicting frontier operation; its single value then causally supersedes those branches.

After applying all currently available contiguous operations and dependencies, a device may publish a checkpoint containing its `seen` vector. It must not claim through a gap, unvalidated file, unresolved dependency, or file that has not been incorporated into local state. Checkpoints can accelerate scans and show progress, but missing checkpoints and stale devices are expected. They are not acknowledgements from every device and cannot establish global quiescence.

## Examples

**Add.** Device A creates stroke `stroke-uuid` at sequence 5 with context `{A: 4}`. It publishes one `put`; every reader that receives it validates the slide identity and imports the stroke once. The matching operation path and ID make a retry harmless.

**Erase.** Device A erases that stroke at sequence 6 with context `{A: 5, B: 2}`. The erase causally observes the add (and B's first two operations), so the stroke is absent after both operations arrive, regardless of arrival order. The erase record remains as a tombstone in the log.

**Concurrent edits.** A and B both read the same text note after seeing `{A: 8, B: 3}`. A publishes a changed text at `{A: 9, B: 3}` while B publishes different text at `{A: 8, B: 4}`. Neither context sees the other's operation, so both values remain as conflict branches; timestamps do not choose a winner. After the user selects or combines the desired text, A publishes a new put with context `{A: 9, B: 4}`. That resolution causally observes both branches and becomes the sole current value.

**Concurrent erase and edit.** If B erases while A edits without observing B's erase, the frontier contains both a tombstone and a put. Keep both recoverable and request an explicit resolution. A later erase that sees both branches resolves to deleted; a later put that sees both branches resolves to the edited value.

## Safe cleanup and failure behavior

Version 1 does not automatically compact, prune, or garbage-collect operation or checkpoint files. In particular, an erase tombstone must not be dropped merely because one device's checkpoint has passed it: another device may be offline indefinitely or may be restoring an old backup, and shared-folder providers do not give this protocol a complete membership/acknowledgement barrier. Checkpoints are never a deletion license.

Users may remove a whole sync workspace only as an explicit unlink/reset action after pausing sync on all participating devices and making a separate backup of any work they want to keep. Local SQLite data is not deleted by unlink/reset. Re-pairing an existing local database to an empty/different workspace must be an explicit user action; the app must not infer that missing shared files mean the user's local annotations should be erased. Unknown files, malformed records, and unsupported versions are retained for diagnosis or forward compatibility. No cleanup path removes local app data, PDFs, logs, or credentials as a side effect.

## Compatibility check against current storage

The wire value shapes are based on `PenStroke` and `TextNote` from `src/persistenceModels.ts`, and the normalized point `{x, y, pressure, time}` from `src/inkGeometry.ts`. The local SQLite `annotations` table stores parent IDs, a kind, and a JSON payload. The protocol discriminator (`stroke`/`text`) is wire-only; the local store infers stroke versus text from its `kind` column and payload. Stable entity IDs and parent checks use the existing `conferenceId`, `talkId`, `deckId`, `slideId`, and annotation `id` values, while operation IDs remain separate from app entity IDs.

This is not yet a lossless round-trip compatibility claim. `TextNote.width` is present in the model and written into the JSON payload by the current store, but `rowToAnnotation` does not restore it when reading a text note. Before sync implementation relies on this field, the local store read path must be repaired and covered by a persistence round-trip regression test. The protocol keeps `width` optional to match the model; until that prerequisite lands, a read/modify/write path can lose it.

This document does not claim that current storage implements causal frontiers, conflict branches, folder watching, or checkpoints. Those are later implementation work and require their own checklist item and verification.

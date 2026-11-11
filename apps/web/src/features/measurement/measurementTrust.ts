import {
  hashKey,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { ApiError } from "../../api/errors";
import {
  checkedSpec,
  checkedPage,
  checkedRevision,
  uuid,
  type Spec,
  type Revision,
  type Summary,
  type Page,
} from "./model";

export type MeasurementContext = {
  scope: string;
  organizationId: string;
  generation: number;
  projectId: string;
  styleId: string;
  current: () => boolean;
};
type Kind = "spec" | "history" | "revision" | "mutation";
type Request = {
  kind: Kind;
  specId?: string;
  revisionId?: string;
  max?: number;
  limit?: number;
};
type Fact = { summary: Summary; full?: Revision };
type Window = { max: number; page: Page };
type Registry = {
  epoch: object;
  context: MeasurementContext;
  owners: Map<object, () => boolean>;
  version: number;
  specId?: string;
  identity?: Pick<Spec, "id" | "styleId" | "createdAt">;
  absence: boolean;
  observedAbsence: boolean;
  head: number;
  headId?: string;
  specView?: Spec;
  facts: Map<string, Fact>;
  numbers: Map<number, string>;
  windows: Map<string, Window>;
  cacheFailures: Set<string>;
  networkFailures: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
};
type Store = {
  contexts: Map<string, Registry>;
  listeners: Map<string, Set<() => void>>;
  unsubscribe: () => void;
  queued: Set<string>;
};
type Read = {
  client: QueryClient;
  key: string;
  epoch: object;
  context: MeasurementContext;
  request: Request;
  signal: AbortSignal;
};
const clients = new WeakMap<QueryClient, Store>();
const reads = new WeakMap<object, Read>();
export type MeasurementRecoveryRequest =
  | Readonly<{ kind: "spec" }>
  | Readonly<{ kind: "history"; specId: string; max: number; limit: number }>
  | Readonly<{ kind: "revision"; specId: string; revisionId: string }>;
export type MeasurementRecovery = Readonly<{
  channel: string;
  context: Readonly<Omit<MeasurementContext, "current">>;
  cacheFailure: boolean;
  networkFailure: boolean;
  request?: MeasurementRecoveryRequest;
  blockedReason?: string;
}>;
// These weak bindings authorize only a retry of an existing failure. They do
// not store failure state or facts; both remain owned by the original registry.
const recoveryBindings = new WeakMap<
  object,
  {
    client: QueryClient;
    key: string;
    epoch: object;
    channel: string;
  }
>();
export const measurementRecoveryPageSize = 8;
// Per QueryClient limits. Never evict facts from an active context to make room.
export const measurementTrustLimits = Object.freeze({
  contexts: 16,
  revisions: 4096,
  points: 8192,
  windows: 256,
  orphanMs: 300_000,
});
const denied = () => new ApiError(502);
const cancelled = () =>
  new DOMException("Measurement request cancelled", "AbortError");
const contextKey = (c: MeasurementContext) =>
  hashKey([c.scope, c.organizationId, c.generation, c.projectId, c.styleId]);
const windowKey = (max: number, limit: number) => hashKey([max, limit]);
const slot = (r: Request) =>
  r.kind === "history"
    ? `history:${r.max}:${r.limit}`
    : r.kind === "revision"
      ? `revision:${r.revisionId}`
      : r.kind;
const live = (r: Registry) =>
  [...r.owners.values()].some((current) => current());
function matches(key: QueryKey, c: MeasurementContext) {
  return (
    key[0] === "workspace" &&
    key[1] === c.scope &&
    key[2] === c.organizationId &&
    key[3] === "project" &&
    key[4] === c.projectId &&
    key[5] === "style" &&
    key[6] === c.styleId
  );
}
function requestFor(key: QueryKey): Request | undefined {
  if (key[7] === "measurement-spec") return { kind: "spec" };
  if (
    key[7] === "measurement-revisions" &&
    typeof key[8] === "number" &&
    typeof key[9] === "number"
  )
    return { kind: "history", limit: key[8], max: key[9] };
  if (key[7] === "measurement-revision" && typeof key[8] === "string")
    return { kind: "revision", revisionId: key[8] };
}
function emit(store: Store, key: string, r?: Registry) {
  if (r) r.version++;
  if (store.queued.has(key)) return;
  store.queued.add(key);
  // Selection can run during render. Notify observers after that render, never
  // update another React component synchronously from a selector.
  queueMicrotask(() => {
    store.queued.delete(key);
    store.listeners.get(key)?.forEach((listener) => listener());
  });
}
// Cache validation owns only cache failures. It cannot recover an authenticated read.
function recordCacheValidation(
  store: Store,
  key: string,
  r: Registry,
  request: Request,
  failed: boolean,
) {
  const channel = slot(request);
  if (r.cacheFailures.has(channel) === failed) return;
  if (failed) r.cacheFailures.add(channel);
  else r.cacheFailures.delete(channel);
  emit(store, key, r);
}
function recordNetworkFailure(
  store: Store,
  key: string,
  r: Registry,
  request: Request,
) {
  const channel = slot(request);
  if (r.networkFailures.has(channel)) return;
  r.networkFailures.add(channel);
  emit(store, key, r);
}
function hasBlockingMeasurementFailure(r: Registry) {
  return r.cacheFailures.size > 0 || r.networkFailures.size > 0;
}
function disposeWhenEmpty(client: QueryClient, store: Store) {
  queueMicrotask(() => {
    if (
      !store.contexts.size &&
      !store.listeners.size &&
      clients.get(client) === store
    ) {
      store.unsubscribe();
      clients.delete(client);
    }
  });
}
function retire(client: QueryClient, store: Store, key: string) {
  const r = store.contexts.get(key);
  if (!r) return;
  clearTimeout(r.timer);
  store.contexts.delete(key);
  emit(store, key);
  disposeWhenEmpty(client, store);
}
function cleanup(client: QueryClient, store: Store, key: string) {
  const r = store.contexts.get(key);
  if (!r) return;
  if (r.owners.size) {
    if (!live(r)) retire(client, store, key);
    return;
  }
  if (
    !client
      .getQueryCache()
      .getAll()
      .some((q) => matches(q.queryKey, r.context) && requestFor(q.queryKey))
  )
    retire(client, store, key);
}
function storeFor(client: QueryClient) {
  let store = clients.get(client);
  if (store) return store;
  const created: Store = {
    contexts: new Map(),
    listeners: new Map(),
    unsubscribe: () => {},
    queued: new Set(),
  };
  clients.set(client, created);
  created.unsubscribe = client.getQueryCache().subscribe((event) => {
    for (const [key, r] of [...created.contexts]) {
      cleanup(client, created, key);
      if (created.contexts.get(key) !== r || !live(r)) continue;
      if (
        event.type !== "updated" ||
        event.action.type !== "success" ||
        !matches(event.query.queryKey, r.context)
      )
        continue;
      const req = requestFor(event.query.queryKey);
      if (!req) continue;
      try {
        const value = event.query.state.data;
        if (req.kind === "spec") checkSpec(r, value);
        else if (req.kind === "history")
          checkHistory(r, value, req.max!, req.limit!);
        else checkRevision(r, value, req.revisionId!);
        recordCacheValidation(created, key, r, req, false);
      } catch {
        recordCacheValidation(created, key, r, req, true);
      }
    }
  });
  return created;
}
function registry(client: QueryClient, c: MeasurementContext) {
  const store = clients.get(client),
    key = contextKey(c),
    r = store?.contexts.get(key);
  if (!store || !r || !c.current() || !live(r)) throw denied();
  return { store, key, r };
}
export function retainMeasurementTrust(
  client: QueryClient,
  c: MeasurementContext,
  owner: object,
) {
  if (!c.current()) return () => {};
  const store = storeFor(client),
    key = contextKey(c);
  // ABA uses a distinct generation even though existing query keys deliberately
  // remain compatible. Old-generation receipts/facts can never seed this epoch.
  for (const [oldKey, old] of [...store.contexts]) {
    cleanup(client, store, oldKey);
    if (
      old.context.scope === c.scope &&
      old.context.organizationId === c.organizationId &&
      old.context.generation !== c.generation
    )
      retire(client, store, oldKey);
  }
  let r = store.contexts.get(key);
  if (!r) {
    if (store.contexts.size >= measurementTrustLimits.contexts) {
      for (const [oldKey, old] of [...store.contexts]) {
        if (!old.owners.size) retire(client, store, oldKey);
        if (store.contexts.size < measurementTrustLimits.contexts) break;
      }
    }
    // The query surfaces a safe validation error if all bounded slots are live.
    if (store.contexts.size >= measurementTrustLimits.contexts) return () => {};
    r = {
      epoch: {},
      context: c,
      owners: new Map(),
      version: 1,
      absence: false,
      observedAbsence: false,
      head: 0,
      facts: new Map(),
      numbers: new Map(),
      windows: new Map(),
      cacheFailures: new Set(),
      networkFailures: new Set(),
    };
    store.contexts.set(key, r);
  }
  clearTimeout(r.timer);
  r.owners.set(owner, c.current);
  emit(store, key, r);
  const retained = r;
  return () => {
    if (store.contexts.get(key) !== retained) return;
    retained.owners.delete(owner);
    cleanup(client, store, key);
    if (!retained.owners.size && store.contexts.get(key) === retained) {
      clearTimeout(retained.timer);
      retained.timer = setTimeout(() => {
        if (!retained.owners.size) retire(client, store, key);
      }, measurementTrustLimits.orphanMs);
    }
  };
}
export function subscribeMeasurementTrust(
  client: QueryClient,
  c: MeasurementContext,
  listener: () => void,
) {
  const store = storeFor(client),
    key = contextKey(c);
  let listeners = store.listeners.get(key);
  if (!listeners) {
    listeners = new Set();
    store.listeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) store.listeners.delete(key);
    cleanup(client, store, key);
    disposeWhenEmpty(client, store);
  };
}
export function measurementTrustVersion(
  client: QueryClient,
  c: MeasurementContext,
) {
  return clients.get(client)?.contexts.get(contextKey(c))?.version ?? 0;
}
function summary(r: Revision): Summary {
  return {
    id: r.id,
    measurementSpecId: r.measurementSpecId,
    styleId: r.styleId,
    revisionNumber: r.revisionNumber,
    baseSize: r.baseSize,
    unitSystem: r.unitSystem,
    pointCount: r.points.length,
    createdAt: r.createdAt,
  };
}
function summaryCopy(r: Summary): Summary {
  return Object.freeze({
    id: r.id,
    measurementSpecId: r.measurementSpecId,
    styleId: r.styleId,
    revisionNumber: r.revisionNumber,
    baseSize: r.baseSize,
    unitSystem: r.unitSystem,
    pointCount: r.pointCount,
    createdAt: r.createdAt,
  });
}
function fullCopy(r: Revision): Revision {
  const copy: Revision = {
    id: r.id,
    measurementSpecId: r.measurementSpecId,
    styleId: r.styleId,
    revisionNumber: r.revisionNumber,
    baseSize: r.baseSize,
    unitSystem: r.unitSystem,
    createdAt: r.createdAt,
    points: r.points.map((p) =>
      Object.freeze({
        position: p.position,
        code: p.code,
        label: p.label,
        value: p.value,
        tolerancePlus: p.tolerancePlus,
        toleranceMinus: p.toleranceMinus,
        notes: p.notes,
      }),
    ),
  };
  Object.freeze(copy.points);
  return Object.freeze(copy);
}
const sameSummary = (a: Summary, b: Summary) =>
  JSON.stringify(summaryCopy(a)) === JSON.stringify(summaryCopy(b));
const sameFull = (a: Revision, b: Revision) =>
  JSON.stringify(fullCopy(a)) === JSON.stringify(fullCopy(b));
function bind(r: Registry, id: string) {
  if (r.specId && r.specId !== id) throw denied();
  r.specId = id;
  r.absence = false;
}
function addSummary(r: Registry, candidate: Summary) {
  bind(r, candidate.measurementSpecId);
  const old = r.facts.get(candidate.id),
    number = r.numbers.get(candidate.revisionNumber);
  if (
    (old && !sameSummary(old.summary, candidate)) ||
    (number && number !== candidate.id)
  )
    throw denied();
  if (!old)
    r.facts.set(
      candidate.id,
      Object.freeze({ summary: summaryCopy(candidate) }),
    );
  r.numbers.set(candidate.revisionNumber, candidate.id);
}
function addFull(r: Registry, candidate: Revision) {
  addSummary(r, summary(candidate));
  const old = r.facts.get(candidate.id)!;
  if (old.full && !sameFull(old.full, candidate)) throw denied();
  if (!old.full)
    r.facts.set(
      candidate.id,
      Object.freeze({ summary: old.summary, full: fullCopy(candidate) }),
    );
}
function coverage(page: Page, max: number, numbers: Iterable<number>) {
  const present = new Set(page.items.map((r) => r.revisionNumber)),
    tail = page.items.at(-1)?.revisionNumber;
  for (const n of numbers) {
    if (n > max || present.has(n)) continue;
    if (
      page.items.length < page.limit ||
      tail === undefined ||
      n >= tail ||
      page.nextMaxRevisionNumber === null ||
      n > page.nextMaxRevisionNumber
    )
      throw denied();
  }
}
function checkWindows(r: Registry) {
  const known = new Set(r.numbers.keys());
  for (const { page } of r.windows.values())
    if (page.nextMaxRevisionNumber !== null)
      known.add(page.nextMaxRevisionNumber);
  for (const { max, page } of r.windows.values()) coverage(page, max, known);
}
function draft(r: Registry): Registry {
  return {
    ...r,
    facts: new Map(r.facts),
    numbers: new Map(r.numbers),
    windows: new Map(r.windows),
  };
}
function commit(
  store: Store,
  key: string,
  r: Registry,
  next: Registry,
  channel: string,
) {
  checkWindows(next);
  let revisions = 0,
    points = 0,
    windows = 0;
  for (const entry of store.contexts.values()) {
    const value = entry === r ? next : entry;
    revisions += value.facts.size;
    windows += value.windows.size;
    for (const fact of value.facts.values())
      points += fact.full?.points.length ?? 0;
  }
  if (
    revisions > measurementTrustLimits.revisions ||
    points > measurementTrustLimits.points ||
    windows > measurementTrustLimits.windows
  )
    throw denied();
  let specView = r.specView;
  if (next.identity && next.headId) {
    const full = next.facts.get(next.headId)?.full;
    if (!full) throw denied();
    if (!specView || specView.latestRevision !== full)
      specView = Object.freeze({ ...next.identity, latestRevision: full });
  }
  // No live state is touched until every identity/content/coverage/budget check passes.
  r.specId = next.specId;
  r.identity = next.identity;
  r.absence = next.absence;
  r.observedAbsence = next.observedAbsence;
  r.head = next.head;
  r.headId = next.headId;
  r.facts = next.facts;
  r.numbers = next.numbers;
  r.windows = next.windows;
  r.specView = specView;
  // Only this fully validated, authenticated commit can recover its read slot.
  r.cacheFailures.delete(channel);
  r.networkFailures.delete(channel);
  if (channel === "spec") {
    // Existing explicit Spec reconciliation resolves an ambiguous mutation,
    // without rebasing a draft or sending another mutation.
    r.cacheFailures.delete("mutation");
    r.networkFailures.delete("mutation");
  }
  emit(store, key, r);
}
// Candidate selectors never register facts. Unknown cache entries cannot establish
// an identity, an absence, a head, a full POM snapshot, or a page envelope.
function checkSpec(r: Registry, value: unknown, retained = false): Spec | null {
  if (value === null) {
    if (!(retained ? r.observedAbsence : r.absence && !r.specId))
      throw denied();
    return null;
  }
  // The model is the sole structural policy; its public typed API is guarded here
  // by an actual runtime call, not by treating a cast as validation.
  const candidate = checkedSpec(value as Spec, r.context.styleId);
  if (
    !r.identity ||
    candidate.id !== r.identity.id ||
    candidate.createdAt !== r.identity.createdAt
  )
    throw denied();
  const fact = r.facts.get(candidate.latestRevision.id)?.full;
  if (!fact || !sameFull(fact, candidate.latestRevision)) throw denied();
  if (
    !retained &&
    (candidate.latestRevision.revisionNumber !== r.head ||
      candidate.latestRevision.id !== r.headId ||
      r.head < Math.max(0, ...r.numbers.keys()))
  )
    throw denied();
  return retained ? candidate : r.specView!;
}
function checkHistory(
  r: Registry,
  value: unknown,
  max: number,
  limit: number,
): Page {
  if (!r.specId) throw denied();
  const page = checkedPage(
      value as Page,
      r.context.styleId,
      r.specId,
      limit,
      max,
    ),
    expected = r.windows.get(windowKey(max, limit))?.page;
  if (
    !expected ||
    page.limit !== expected.limit ||
    page.nextMaxRevisionNumber !== expected.nextMaxRevisionNumber ||
    page.items.length !== expected.items.length ||
    page.items.some((row, i) => !sameSummary(row, expected.items[i]))
  )
    throw denied();
  return expected;
}
function checkRevision(r: Registry, value: unknown, id: string): Revision {
  if (!r.specId) throw denied();
  const revision = checkedRevision(
      value as Revision,
      r.context.styleId,
      r.specId,
      id,
    ),
    expected = r.facts.get(id)?.full;
  if (!expected || !sameFull(revision, expected)) throw denied();
  return expected;
}
function selection<T>(
  client: QueryClient,
  c: MeasurementContext,
  request: Request,
  check: (r: Registry) => T,
) {
  const { store, key, r } = registry(client, c);
  try {
    const value = check(r);
    recordCacheValidation(store, key, r, request, false);
    return value;
  } catch (error) {
    recordCacheValidation(store, key, r, request, true);
    throw error;
  }
}
export const selectMeasurementSpec = (
  client: QueryClient,
  c: MeasurementContext,
  value: Spec | null,
) => selection(client, c, { kind: "spec" }, (r) => checkSpec(r, value));
export const selectMeasurementHistory = (
  client: QueryClient,
  c: MeasurementContext,
  value: Page,
  max: number,
  limit: number,
) =>
  selection(client, c, { kind: "history", max, limit }, (r) =>
    checkHistory(r, value, max, limit),
  );
export const selectMeasurementRevision = (
  client: QueryClient,
  c: MeasurementContext,
  value: Revision,
  id: string,
) =>
  selection(client, c, { kind: "revision", revisionId: id }, (r) =>
    checkRevision(r, value, id),
  );
export function hasMeasurementProvenance(
  client: QueryClient,
  c: MeasurementContext,
  request: Request,
  value: unknown,
) {
  try {
    const { r } = registry(client, c);
    if (request.kind === "spec") checkSpec(r, value);
    else if (request.kind === "history")
      checkHistory(r, value, request.max!, request.limit!);
    else checkRevision(r, value, request.revisionId!);
    return true;
  } catch {
    return false;
  }
}
export function retainedMeasurementSpec(
  client: QueryClient,
  c: MeasurementContext,
  value: Spec | null,
) {
  return checkSpec(registry(client, c).r, value, true);
}
// Separate observer failure state from TanStack's cache-success status. A raw
// alias can change without rerunning a memoized selector; the cache subscription
// still detects it. A trusted cached value cannot recover a network failure.
export function measurementRecoveryRequired(
  client: QueryClient,
  c: MeasurementContext,
  request?: Request,
) {
  try {
    const { r } = registry(client, c);
    return request
      ? r.cacheFailures.has(slot(request)) ||
          r.networkFailures.has(slot(request)) ||
          (request.kind === "spec" &&
            (r.cacheFailures.has("mutation") ||
              r.networkFailures.has("mutation")))
      : hasBlockingMeasurementFailure(r);
  } catch {
    return false;
  }
}
function recoveryRequest(
  r: Registry,
  channel: string,
): {
  request?: MeasurementRecoveryRequest;
  blockedReason?: string;
} {
  if (channel === "spec" || channel === "mutation")
    return { request: Object.freeze({ kind: "spec" }) };
  if (!r.specId)
    return {
      blockedReason:
        "Load the authoritative Measurement Spec before retrying this request.",
    };
  if (channel.startsWith("history:")) {
    const parts = /^history:(\d+):(\d+)$/.exec(channel),
      max = Number(parts?.[1]),
      limit = Number(parts?.[2]);
    if (
      !Number.isSafeInteger(max) ||
      max < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      return {
        blockedReason:
          "Valid history request bounds are required before this request can be retried.",
      };
    if (max > r.head)
      return {
        blockedReason:
          "Authenticate a Measurement Spec head covering this history window before retrying.",
      };
    if (
      !r.networkFailures.has(channel) &&
      !r.windows.has(windowKey(max, limit))
    )
      return {
        blockedReason:
          "An authenticated history window is required before this cached request can be retried.",
      };
    return {
      request: Object.freeze({ kind: "history", specId: r.specId, max, limit }),
    };
  }
  if (channel.startsWith("revision:")) {
    const revisionId = channel.slice("revision:".length);
    if (!uuid.safeParse(revisionId).success || !r.facts.has(revisionId))
      return {
        blockedReason:
          "An authenticated revision identity is required before this request can be retried.",
      };
    return {
      request: Object.freeze({
        kind: "revision",
        specId: r.specId,
        revisionId,
      }),
    };
  }
  return {
    blockedReason:
      "A recognized Measurement request is required before recovery is available.",
  };
}
function* failedChannels(r: Registry) {
  yield* r.cacheFailures;
  for (const channel of r.networkFailures)
    if (!r.cacheFailures.has(channel)) yield channel;
}
export function measurementRecoveries(
  client: QueryClient,
  c: MeasurementContext,
  offset = 0,
) {
  try {
    const { key, r } = registry(client, c);
    let total = r.cacheFailures.size;
    for (const channel of r.networkFailures)
      if (!r.cacheFailures.has(channel)) total++;
    const start = Math.min(
      Number.isSafeInteger(offset) && offset >= 0 ? offset : 0,
      Math.max(0, Math.ceil(total / measurementRecoveryPageSize) - 1) *
        measurementRecoveryPageSize,
    );
    const context = Object.freeze({
      scope: c.scope,
      organizationId: c.organizationId,
      generation: c.generation,
      projectId: c.projectId,
      styleId: c.styleId,
    });
    const items: MeasurementRecovery[] = [];
    let index = 0;
    for (const channel of failedChannels(r)) {
      if (index++ < start) continue;
      const descriptor = Object.freeze({
        channel,
        context,
        cacheFailure: r.cacheFailures.has(channel),
        networkFailure: r.networkFailures.has(channel),
        ...recoveryRequest(r, channel),
      });
      recoveryBindings.set(descriptor, {
        client,
        key,
        epoch: r.epoch,
        channel,
      });
      items.push(descriptor);
      if (items.length === measurementRecoveryPageSize) break;
    }
    return Object.freeze({
      items: Object.freeze(items),
      total,
      offset: start,
      head: r.head,
      unavailable: false,
    });
  } catch {
    return Object.freeze({
      items: Object.freeze([] as MeasurementRecovery[]),
      total: 0,
      offset: 0,
      head: 0,
      unavailable: true,
    });
  }
}
function recoveryOwner(
  client: QueryClient,
  c: MeasurementContext,
  descriptor: MeasurementRecovery,
) {
  const binding = recoveryBindings.get(descriptor),
    { key, r } = registry(client, c);
  if (
    !binding ||
    binding.client !== client ||
    binding.key !== key ||
    binding.epoch !== r.epoch
  )
    throw denied();
  return { r, channel: binding.channel };
}
export function measurementRecoveryState(
  client: QueryClient,
  c: MeasurementContext,
  descriptor: MeasurementRecovery,
) {
  try {
    const { r, channel } = recoveryOwner(client, c, descriptor);
    return r.cacheFailures.has(channel) || r.networkFailures.has(channel)
      ? "pending"
      : "recovered";
  } catch {
    return "retired";
  }
}
export function requireMeasurementRecovery(
  client: QueryClient,
  c: MeasurementContext,
  descriptor: MeasurementRecovery,
) {
  const { r, channel } = recoveryOwner(client, c, descriptor);
  if (!r.cacheFailures.has(channel) && !r.networkFailures.has(channel))
    throw denied();
  const { request } = recoveryRequest(r, channel);
  if (!request) throw denied();
  return request;
}
export function beginMeasurementRecoveryRead(
  client: QueryClient,
  c: MeasurementContext,
  descriptor: MeasurementRecovery,
  expected: Request,
  signal: AbortSignal,
) {
  const request = requireMeasurementRecovery(client, c, descriptor);
  if (
    slot(request) !== slot(expected) ||
    (request.kind !== "spec" && request.specId !== expected.specId)
  )
    throw denied();
  return beginMeasurementRead(client, c, request, signal);
}
export function measurementEditingAllowed(
  client: QueryClient,
  c: MeasurementContext,
  value: Spec | null | undefined,
) {
  try {
    const { r } = registry(client, c);
    if (hasBlockingMeasurementFailure(r) || value === undefined) return false;
    checkSpec(r, value);
    return true;
  } catch {
    return false;
  }
}
export function requireMeasurementWrite(
  client: QueryClient,
  c: MeasurementContext,
  value: Spec | null,
  mode: string | null,
  baseline: number | null,
) {
  const { r } = registry(client, c);
  // Inspect actual active raw query values as well, closing the interval between
  // a cache write and React's batched observer/DOM update.
  for (const query of client.getQueryCache().getAll()) {
    if (!matches(query.queryKey, c) || !query.getObserversCount()) continue;
    const req = requestFor(query.queryKey);
    if (
      req &&
      query.state.data !== undefined &&
      !hasMeasurementProvenance(client, c, req, query.state.data)
    )
      throw denied();
    if (req && query.state.status === "error") throw denied();
  }
  if (!measurementEditingAllowed(client, c, value)) throw denied();
  if (mode === "create") {
    if (value !== null || !r.absence) throw denied();
  } else if (
    mode !== "revision" ||
    !value ||
    baseline === null ||
    !r.numbers.has(baseline) ||
    !r.facts.get(r.numbers.get(baseline)!)?.full
  )
    throw denied();
}
export function beginMeasurementRead(
  client: QueryClient,
  c: MeasurementContext,
  request: Request,
  signal: AbortSignal,
) {
  const { key, r } = registry(client, c);
  if (signal.aborted) throw cancelled();
  const receipt = Object.freeze({});
  reads.set(receipt, {
    client,
    key,
    epoch: r.epoch,
    context: c,
    request,
    signal,
  });
  return receipt;
}
function take(receipt: object, kind: Kind) {
  const read = reads.get(receipt);
  reads.delete(receipt);
  if (!read || read.request.kind !== kind) throw denied();
  const { store, key, r } = registry(read.client, read.context);
  if (r.epoch !== read.epoch || read.signal.aborted || !read.context.current())
    throw cancelled();
  return { read, store, key, r };
}
export function rejectMeasurementRead(receipt: object) {
  const read = reads.get(receipt);
  reads.delete(receipt);
  if (!read || read.signal.aborted || !read.context.current()) return;
  const store = clients.get(read.client),
    r = store?.contexts.get(read.key);
  if (store && r?.epoch === read.epoch && live(r))
    recordNetworkFailure(store, read.key, r, read.request);
}
function accept<T>(
  receipt: object,
  kind: Kind,
  update: (next: Registry, read: Read) => T,
) {
  const { read, store, key, r } = take(receipt, kind);
  try {
    const next = draft(r),
      result = update(next, read);
    commit(store, key, r, next, slot(read.request));
    return structuredClone(result);
  } catch (error) {
    recordNetworkFailure(store, key, r, read.request);
    throw error;
  }
}
export function acceptMeasurementSpec(receipt: object, value: Spec | null) {
  return accept(receipt, "spec", (r) => {
    if (value === null) {
      if (r.specId || r.facts.size) throw denied();
      r.absence = true;
      r.observedAbsence = true;
      return null;
    }
    const spec = checkedSpec(value, r.context.styleId);
    bind(r, spec.id);
    if (
      r.identity &&
      (r.identity.createdAt !== spec.createdAt ||
        r.identity.styleId !== spec.styleId)
    )
      throw denied();
    const highest = Math.max(0, ...r.numbers.keys());
    if (spec.latestRevision.revisionNumber < Math.max(r.head, highest))
      throw denied();
    addFull(r, spec.latestRevision);
    r.identity ??= Object.freeze({
      id: spec.id,
      styleId: spec.styleId,
      createdAt: spec.createdAt,
    });
    r.absence = false;
    r.head = spec.latestRevision.revisionNumber;
    r.headId = spec.latestRevision.id;
    return { ...r.identity, latestRevision: r.facts.get(r.headId)!.full! };
  });
}
export function acceptMeasurementHistory(receipt: object, value: Page) {
  return accept(receipt, "history", (r, read) => {
    const { specId, max, limit } = read.request;
    if (!specId || max === undefined || limit === undefined) throw denied();
    const page = checkedPage(value, r.context.styleId, specId, limit, max);
    bind(r, specId);
    const key = windowKey(max, limit),
      old = r.windows.get(key)?.page;
    if (
      old &&
      (page.limit !== old.limit ||
        page.nextMaxRevisionNumber !== old.nextMaxRevisionNumber ||
        page.items.length !== old.items.length ||
        page.items.some((row, i) => !sameSummary(row, old.items[i])))
    )
      throw denied();
    for (const row of page.items) addSummary(r, row);
    if (!old) {
      const snapshot: Page = {
        limit: page.limit,
        nextMaxRevisionNumber: page.nextMaxRevisionNumber,
        items: page.items.map(summaryCopy),
      };
      Object.freeze(snapshot.items);
      Object.freeze(snapshot);
      r.windows.set(key, { max, page: snapshot });
    }
    return r.windows.get(key)!.page;
  });
}
export function acceptMeasurementRevision(
  receipt: object,
  value: Revision,
  mutation = false,
) {
  return accept(receipt, mutation ? "mutation" : "revision", (r, read) => {
    if (!read.request.specId) throw denied();
    const revision = checkedRevision(
      value,
      r.context.styleId,
      read.request.specId,
      read.request.revisionId,
    );
    addFull(r, revision);
    if (mutation && revision.revisionNumber > r.head) {
      r.head = revision.revisionNumber;
      r.headId = revision.id;
    }
    return r.facts.get(revision.id)!.full!;
  });
}

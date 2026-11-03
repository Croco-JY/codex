import { hashKey, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { ApiError } from "../../api/errors";
import {
  checkedEvents,
  sameEventFacts,
  snapshotEvents,
  type EventHistorySnapshot,
} from "./model";

type Event = EventHistorySnapshot["items"][number];
type History = {
  epoch: object;
  owners: Map<object, number>;
  windows: Map<string, EventHistorySnapshot>;
  ids: Map<string, Event>;
  numbers: Map<number, Event>;
};
type Store = {
  histories: Map<string, History>;
  unsubscribe: () => void;
};
const clients = new WeakMap<QueryClient, Store>();
const reads = new WeakMap<
  object,
  {
    client: QueryClient;
    context: string;
    epoch: object;
    release: string;
    max: number;
    limit: number;
  }
>();

function cleanup(
  client: QueryClient,
  store: Store,
  context: string,
  removed?: object,
) {
  if (clients.get(client) !== store) return;
  const history = store.histories.get(context);
  if (!history || history.owners.size) return;
  const cached = client.getQueryCache().getAll().some((query) =>
    query !== removed &&
    query.queryKey.at(-3) === "events" &&
    hashKey(query.queryKey.slice(0, -2)) === context,
  );
  if (cached) return;
  store.histories.delete(context);
  if (!store.histories.size) {
    store.unsubscribe();
    clients.delete(client);
  }
}

// Owners identify live pinned histories, never separate immutable authorities.
// Query objects are used only to bound cache retention, not to identify truth.
export function retainEventHistory(
  client: QueryClient,
  key: QueryKey,
  owner: object,
  pinnedHead: number,
) {
  const context = hashKey(key);
  let store = clients.get(client);
  if (!store) {
    const created: Store = { histories: new Map(), unsubscribe: () => {} };
    clients.set(client, created);
    created.unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.type === "removed" && event.query.queryKey.at(-3) === "events")
        cleanup(
          client, created, hashKey(event.query.queryKey.slice(0, -2)), event.query,
        );
    });
    store = created;
  }
  let history = store.histories.get(context);
  if (!history) {
    history = {
      epoch: {},
      owners: new Map(),
      windows: new Map(),
      ids: new Map(),
      numbers: new Map(),
    };
    store.histories.set(context, history);
  }
  history.owners.set(owner, pinnedHead);
  const retainedStore = store;
  const retainedHistory = history;
  return () => {
    if (
      clients.get(client) !== retainedStore ||
      retainedStore.histories.get(context) !== retainedHistory
    ) return;
    retainedHistory.owners.delete(owner);
    cleanup(client, retainedStore, context);
  };
}

function historyFor(client: QueryClient, context: string) {
  const history = clients.get(client)?.histories.get(context);
  if (!history) throw new ApiError(502);
  return history;
}

function canRead(history: History, max: number) {
  return [...history.owners.values()].some((head) => head >= max);
}

// The opaque receipt binds this in-flight read to the current registry epoch.
// A response from an ended/cleared context cannot seed a replacement registry.
export function beginEventHistoryRead(
  client: QueryClient,
  key: QueryKey,
  release: string,
  max: number,
  limit: number,
) {
  const context = hashKey(key);
  const history = historyFor(client, context);
  if (!canRead(history, max)) throw new ApiError(502);
  const receipt = Object.freeze({});
  reads.set(receipt, { client, context, epoch: history.epoch, release, max, limit });
  return receipt;
}

function checkedWindow(
  history: History,
  value: unknown,
  release: string,
  max: number,
  limit: number,
) {
  const window = hashKey([max, limit]);
  const expected = history.windows.get(window);
  const page = checkedEvents(value, release, max, limit, expected);
  for (const event of page.items) {
    const id = history.ids.get(event.id);
    const number = history.numbers.get(event.eventNumber);
    if (
      (id && !sameEventFacts(event, id)) ||
      (number && !sameEventFacts(event, number))
    )
      throw new ApiError(502);
  }
  return { window, expected, page };
}

export function selectEventHistory(
  client: QueryClient,
  key: QueryKey,
  value: unknown,
  release: string,
  max: number,
  limit: number,
) {
  const history = historyFor(client, hashKey(key));
  const { expected, page } = checkedWindow(history, value, release, max, limit);
  // An unknown cached envelope cannot establish membership or event facts.
  if (!expected) throw new ApiError(502);
  return page;
}

// Only queryFn calls this, after authenticated Workspace.run has validated the
// current Actor/Organization/generation and cancellation. Check and registration
// are synchronous; no rejected candidate can partially mutate the registry.
export function acceptEventHistoryRead(receipt: object, value: unknown) {
  const read = reads.get(receipt);
  reads.delete(receipt);
  if (!read) throw new ApiError(502);
  const history = historyFor(read.client, read.context);
  if (history.epoch !== read.epoch || !canRead(history, read.max))
    throw new ApiError(502);
  const { window, expected, page } = checkedWindow(
    history, value, read.release, read.max, read.limit,
  );
  if (!expected) {
    const snapshot = snapshotEvents(page);
    history.windows.set(window, snapshot);
    for (const event of snapshot.items) {
      history.ids.set(event.id, event);
      history.numbers.set(event.eventNumber, event);
    }
  }
  return page;
}

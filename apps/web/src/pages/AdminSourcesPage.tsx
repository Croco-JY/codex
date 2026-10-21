import { useState } from "react";
import { Link } from "react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSession } from "../app/session";
import { Button, Stack, StatusBadge, Surface } from "../ui";
import { Facts } from "../features/commercial/ReadUI";
import {
  sourceOptions,
  uniqueRows,
  useAdminReadError,
} from "../features/admin-sources/data";
import { HistoryStatus } from "../features/admin-sources/FormUI";
import {
  editableSource,
  isUuid,
  sourceLabel,
  text,
  type EditableSource,
  type Source,
} from "../features/admin-sources/model";
import { SourceEditor } from "../features/admin-sources/SourceEditor";
import { RecordWorkspace } from "../features/admin-sources/RecordWorkspace";
import "../features/admin-sources/workspace.css";
type Editor = { create: true } | { source: EditableSource };
export default function AdminSourcesPage() {
  const { scope, capability } = useSession();
  const sources = useInfiniteQuery({
    ...sourceOptions(scope),
    enabled: capability === "ADMIN",
  });
  useAdminReadError(sources.error);
  const rows = uniqueRows(sources.data?.pages);
  const [selected, select] = useState<Source>();
  const [pendingSource, setPendingSource] = useState<Source>();
  const [editor, setEditor] = useState<Editor>();
  const [pendingEditor, setPendingEditor] = useState<Editor>();
  const [dirty, setDirty] = useState(false);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [editorVersion, setEditorVersion] = useState(0);
  const [evidenceActive, setEvidenceActive] = useState(false);
  const openEditor = (next: Editor) => {
    if (dirty) setPendingEditor(next);
    else {
      setEditor(next);
      setEditorVersion((v) => v + 1);
    }
  };
  const choose = (source: Source) => {
    if (source.id === selected?.id) return;
    if (selected || pendingSource || evidenceActive) setPendingSource(source);
    else select(source);
  };
  return (
    <div className="provenance-workspace">
      <Stack>
        <header>
          <Link className="text-link" to="/admin">
            Curation workspace
          </Link>
          <p className="eyebrow">PROTECTED CURATION</p>
          <h1>Sources &amp; Evidence</h1>
          <p className="lead">
            Maintain Source context, persistent external identity, immutable
            Observations and append-only Reviews.
          </p>
        </header>
        <Surface>
          <div className="section-heading">
            <h2>Data Sources</h2>
            <div className="scope-actions">
              <Button
                className="secondary"
                onClick={() => void sources.refetch()}
              >
                Refresh Sources
              </Button>
              <Button onClick={() => openEditor({ create: true })}>
                New Source
              </Button>
            </div>
          </div>
          <div className="admin-source-layout">
            <section aria-label="Loaded Sources">
              <HistoryStatus
                query={sources}
                count={rows.length}
                noun="sources"
                empty="No Sources are loaded in this page."
              />
              <ul className="read-list admin-source-list">
                {rows.map((source, index) => {
                  const safe = editableSource(source);
                  return (
                    <li key={source.id ?? index}>
                      <h3>{sourceLabel(source)}</h3>
                      <div className="network-badges">
                        <StatusBadge
                          tone={source.active === true ? "success" : "neutral"}
                        >
                          {source.active === true
                            ? "Active"
                            : source.active === false
                              ? "Inactive"
                              : "Active state unavailable"}
                        </StatusBadge>
                        <span className="filter-help">
                          {text(source.sourceType)} ·{" "}
                          {text(source.accessMethod)}
                        </span>
                      </div>
                      <details className="read-disclosure">
                        <summary>Source properties</summary>
                        <Facts
                          values={[
                            ["Namespace", source.namespace],
                            ["Base URL", source.baseUrl],
                            [
                              "Normalization policy",
                              source.normalizationPolicy,
                            ],
                            [
                              "Version",
                              typeof source.version === "number" &&
                              Number.isSafeInteger(source.version) &&
                              source.version >= 0
                                ? source.version
                                : "Unavailable",
                            ],
                          ]}
                        />
                        <p className="record-reference">
                          Source reference: {text(source.id)}
                        </p>
                      </details>
                      {!safe && (
                        <p className="filter-help">
                          Incomplete or unsafe current state: this Source cannot
                          be edited.
                        </p>
                      )}
                      <div className="scope-actions">
                        <Button
                          className="secondary small"
                          aria-pressed={
                            !!source.id && selected?.id === source.id
                          }
                          disabled={!isUuid(source.id)}
                          onClick={() => choose(source)}
                        >
                          Select Source {sourceLabel(source)}
                        </Button>
                        <Button
                          className="secondary small"
                          disabled={!safe}
                          onClick={() => {
                            if (safe) openEditor({ source: safe });
                          }}
                        >
                          Edit Source {sourceLabel(source)}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            <div>
              {editor ? (
                <SourceEditor
                  key={editorVersion}
                  initial={"source" in editor ? editor.source : undefined}
                  close={() => {
                    setEditor(undefined);
                    setDirty(false);
                  }}
                  dirty={setDirty}
                  changed={(source) => {
                    if (source && source.id === selected?.id) select(source);
                  }}
                />
              ) : (
                <section className="admin-panel">
                  <h2>Source curation</h2>
                  <p>
                    Select a loaded Source for Record registration, or open a
                    create/edit form. Source code and normalization policy stay
                    read-only during edit.
                  </p>
                  <p>
                    No Source-by-ID lookup or global SourceRecord search is
                    available.
                  </p>
                </section>
              )}
            </div>
          </div>
          {pendingEditor && (
            <div className="notice" role="alert">
              <p>
                Opening another Source form discards the current Source draft.
              </p>
              <div className="scope-actions">
                <Button
                  onClick={() => {
                    setEditor(pendingEditor);
                    setEditorVersion((v) => v + 1);
                    setPendingEditor(undefined);
                    setDirty(false);
                  }}
                >
                  Open form and discard Source draft
                </Button>
                <Button
                  className="secondary"
                  onClick={() => setPendingEditor(undefined)}
                >
                  Keep Source draft
                </Button>
              </div>
            </div>
          )}
          {pendingSource && (
            <div className="notice" role="alert">
              <p>
                Changing selected Source clears the previous Record, Observation
                and Review context and drafts.
              </p>
              <div className="scope-actions">
                <Button
                  onClick={() => {
                    select(pendingSource);
                    setPendingSource(undefined);
                    setSelectionVersion((v) => v + 1);
                    setEvidenceActive(false);
                  }}
                >
                  Change Source and clear context
                </Button>
                <Button
                  className="secondary"
                  onClick={() => setPendingSource(undefined)}
                >
                  Keep current Source
                </Button>
              </div>
            </div>
          )}
        </Surface>
        <RecordWorkspace
          key={`${selected?.id ?? "unselected"}-${selectionVersion}`}
          source={rows.find((source) => source.id === selected?.id) ?? selected}
          onContextActive={setEvidenceActive}
        />
        <p className="filter-help">
          This workspace does not bind external identity to canonical entities.
          Supplier, Facility, Material, Listing, Price and Inventory curation
          are later slices.
        </p>
      </Stack>
    </div>
  );
}

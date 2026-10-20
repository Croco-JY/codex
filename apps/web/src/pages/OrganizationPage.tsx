import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api, requireData } from "../api/client";
import { queryKeys } from "../api/queryKeys";
import { getSession } from "../api/session";
import { useSession } from "../app/session";
import {
  Button,
  Input,
  StatusBadge,
  Surface,
  Stack,
  Skeleton,
  EmptyState,
} from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter an organization name.")
  .max(160, "Use 160 characters or fewer.");
export default function OrganizationPage() {
  const cache = useQueryClient();
  const { selected, select, scope } = useSession();
  const key = queryKeys.organizations(scope);
  const current = () => scope === getSession().key;
  const form = useForm<{ name: string }>({ defaultValues: { name: "" } });
  const [formError, setFormError] = useState("");
  const organizations = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/organizations", {
        signal,
      });
      return requireData(data, response);
    },
  });
  const create = useMutation({
    mutationFn: async (name: string) => {
      const { data, response } = await api.POST("/api/organizations", {
        body: { name },
      });
      return requireData(data, response);
    },
    onSuccess: (org) => {
      if (!current()) return;
      select(org);
      form.reset();
      void cache.invalidateQueries({ queryKey: key });
    },
  });
  const rename = useMutation({
    mutationFn: async (name: string) => {
      if (!selected?.id) throw new Error("Select an organization.");
      const { data, response } = await api.PATCH("/api/organizations/{id}", {
        params: { path: { id: selected.id } },
        body: { name, version: selected.version ?? 0 },
      });
      return requireData(data, response);
    },
    onSuccess: (org) => {
      if (!current()) return;
      select(org);
      void cache.invalidateQueries({ queryKey: key });
    },
  });
  const [renameName, setRenameName] = useState("");
  return (
    <Stack>
      <header>
        <p className="eyebrow">ORGANIZATION</p>
        <h1>Your working context.</h1>
        <p className="lead">
          Membership controls access. Choose the organization you are working
          with. Shared supply records remain independent of this selection.
        </p>
      </header>
      <Surface>
        <h2>Organizations</h2>
        {organizations.isPending ? (
          <Skeleton />
        ) : organizations.isError ? (
          <ApiErrorState
            error={organizations.error}
            retry={() => void organizations.refetch()}
          />
        ) : organizations.data.length === 0 ? (
          <EmptyState title="No organizations yet">
            Create your organization to establish a workspace.
          </EmptyState>
        ) : (
          <ul className="org-list">
            {organizations.data.map((org) => (
              <li key={org.id}>
                <Button
                  aria-pressed={selected?.id === org.id}
                  onClick={() => {
                    select(org);
                    setRenameName(org.name ?? "");
                  }}
                >
                  {org.name}
                </Button>
                <StatusBadge>{org.role}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </Surface>
      <Surface>
        <h2>Create organization</h2>
        <form
          onSubmit={form.handleSubmit((values) => {
            const parsed = nameSchema.safeParse(values.name);
            if (!parsed.success) {
              setFormError(parsed.error.issues[0]?.message ?? "Invalid name");
              return;
            }
            setFormError("");
            create.mutate(parsed.data);
          })}
        >
          <label htmlFor="organization-name">Organization name</label>
          <Input
            id="organization-name"
            autoComplete="organization"
            {...form.register("name")}
          />
          {formError && <p role="alert">{formError}</p>}
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create organization"}
          </Button>
          {create.isError && <ApiErrorState error={create.error} />}
        </form>
      </Surface>
      {selected && (
        <Surface>
          <div className="section-heading">
            <h2>{selected.name}</h2>
            <StatusBadge tone="success">{selected.role}</StatusBadge>
          </div>
          <p className="muted">Organization ID: {selected.id}</p>
          {(selected.role === "ORG_OWNER" || selected.role === "ORG_ADMIN") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = nameSchema.safeParse(renameName);
                if (parsed.success) rename.mutate(parsed.data);
              }}
            >
              <label htmlFor="rename">New organization name</label>
              <Input
                id="rename"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
              />
              <Button type="submit" disabled={rename.isPending}>
                Save name
              </Button>
              {rename.isError && (
                <ApiErrorState
                  error={rename.error}
                  retry={() => {
                    void organizations.refetch().then((result) => {
                      if (!current() || !result.isSuccess) return;
                      select(
                        result.data.find((org) => org.id === selected.id) ??
                          null,
                      );
                      rename.reset();
                    });
                  }}
                />
              )}
            </form>
          )}
        </Surface>
      )}
    </Stack>
  );
}

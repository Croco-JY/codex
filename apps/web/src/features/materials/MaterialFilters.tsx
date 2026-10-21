import { useId, useRef, useState, type ReactNode } from "react";
import { Button, Input } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import {
  commercialKeys,
  draftFrom,
  filterLabels,
  materialTypes,
  units,
  validateDraft,
  type FilterKey,
  type Filters,
} from "./filters";
import type { References } from "./materialQueries";
import { titleCase } from "./MaterialSummary";
import { SupplierPicker } from "./SupplierPicker";
export function MaterialFilters({
  applied,
  references,
  apply,
  clear,
}: {
  applied: Filters;
  references: References;
  apply: (filters: Filters) => void;
  clear: () => void;
}) {
  const [draft, setDraft] = useState(() => draftFrom(applied));
  const [expanded, setExpanded] = useState(() => window.innerWidth >= 900);
  const [errors, setErrors] = useState<Partial<Record<FilterKey, string>>>({});
  const summary = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const set = (key: FilterKey, value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const field = (
    key: FilterKey,
    options?: { integer?: boolean; text?: boolean },
  ) => (
    <div className="filter-field" key={key}>
      <label htmlFor={`${prefix}-${key}`}>{filterLabels[key]}</label>
      <Input
        id={`${prefix}-${key}`}
        value={draft[key]}
        inputMode={
          options?.text ? "text" : options?.integer ? "numeric" : "decimal"
        }
        maxLength={key === "q" ? 200 : key === "color" ? 100 : 80}
        onChange={(event) => set(key, event.target.value)}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `${prefix}-${key}-error` : undefined}
      />
      {errors[key] && (
        <p id={`${prefix}-${key}-error`} className="field-error">
          {errors[key]}
        </p>
      )}
    </div>
  );
  const select = (key: FilterKey, children: ReactNode) => (
    <div className="filter-field">
      <label htmlFor={`${prefix}-${key}`}>{filterLabels[key]}</label>
      <select
        className="input"
        id={`${prefix}-${key}`}
        value={draft[key]}
        onChange={(event) => set(key, event.target.value)}
      >
        <option value="">Any</option>
        {children}
      </select>
    </div>
  );
  const range = (
    name: string,
    min: FilterKey,
    max: FilterKey,
    integer = false,
  ) => (
    <fieldset className="filter-range">
      <legend>{name}</legend>
      {field(min, { integer })}
      {field(max, { integer })}
    </fieldset>
  );
  const commercial = commercialKeys.some((key) => applied[key] !== undefined);
  const selectedCountry = references.countries.data?.find(
    (country) => country.id === draft.originCountryId,
  );
  const selectedFiber = references.fiberList.find(
    (fiber) => fiber.id === draft.fiberTypeId,
  );
  return (
    <details
      className="filter-panel"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Search filters</summary>
      <form
        className="material-filter-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const result = validateDraft(draft);
          setErrors(result.errors);
          if (Object.keys(result.errors).length) {
            requestAnimationFrame(() => summary.current?.focus());
            return;
          }
          apply(result.filters);
        }}
      >
        {Object.keys(errors).length > 0 && (
          <div className="error" role="alert" tabIndex={-1} ref={summary}>
            Check the highlighted filters before applying.
          </div>
        )}
        {field("q", { text: true })}
        {select(
          "materialType",
          materialTypes.map((type) => (
            <option key={type} value={type}>
              {titleCase(type)}
            </option>
          )),
        )}
        {select(
          "originCountryId",
          <>
            {draft.originCountryId && !selectedCountry && (
              <option value={draft.originCountryId}>
                Selected origin — label unavailable
              </option>
            )}
            {references.countries.data
              ?.filter(
                (country) =>
                  country.active || country.id === draft.originCountryId,
              )
              .map((country) => (
                <option value={country.id} key={country.id}>
                  {country.nameEn || country.nameNative}
                  {!country.active ? " (inactive)" : ""}
                </option>
              ))}
          </>,
        )}
        {references.countries.isPending && (
          <p role="status">Loading origins…</p>
        )}
        {references.countries.isError && (
          <ApiErrorState
            title="Origin choices unavailable"
            error={references.countries.error}
            retry={() => void references.countries.refetch()}
          />
        )}
        {select(
          "fiberTypeId",
          <>
            {draft.fiberTypeId && !selectedFiber && (
              <option value={draft.fiberTypeId}>
                Selected fiber — label unavailable
              </option>
            )}
            {references.fiberList
              .filter((fiber) => fiber.active || fiber.id === draft.fiberTypeId)
              .map((fiber) => (
                <option value={fiber.id} key={fiber.id}>
                  {fiber.code} — {fiber.nameEn || fiber.nameLocal}
                  {!fiber.active ? " (inactive)" : ""}
                </option>
              ))}
          </>,
        )}
        {references.fibers.isPending && <p role="status">Loading fibers…</p>}
        {references.fibers.isError && (
          <ApiErrorState
            title="Fiber choices unavailable"
            error={references.fibers.error}
            retry={() => void references.fibers.refetch()}
          />
        )}
        {references.fibers.hasNextPage && (
          <Button
            className="secondary small"
            disabled={references.fibers.isFetchingNextPage}
            onClick={() =>
              void references.fibers.fetchNextPage({ cancelRefetch: false })
            }
          >
            Load more fiber choices
          </Button>
        )}
        {field("color", { text: true })}
        <div className="filter-actions">
          <Button type="submit">Apply filters</Button>
          <Button
            className="secondary"
            onClick={() => {
              setDraft(draftFrom({}));
              setErrors({});
              clear();
            }}
          >
            Clear filters
          </Button>
        </div>
        <details className="filter-group" open={!!applied.catalogSupplierId}>
          <summary>Catalog identity</summary>
          <SupplierPicker
            label="Catalog supplier"
            value={draft.catalogSupplierId}
            onChange={(value) => set("catalogSupplierId", value)}
          />
        </details>
        <details
          className="filter-group"
          open={[
            "minFiberPercentage",
            "maxFiberPercentage",
            "minGsm",
            "maxGsm",
            "minWidthMm",
            "maxWidthMm",
            "minThicknessMm",
            "maxThicknessMm",
          ].some((key) => applied[key as FilterKey] !== undefined)}
        >
          <summary>Technical filters</summary>
          {range(
            "Fiber percentage",
            "minFiberPercentage",
            "maxFiberPercentage",
          )}
          {range("Fabric weight (GSM)", "minGsm", "maxGsm")}
          {range("Fabric width (mm)", "minWidthMm", "maxWidthMm")}
          {range("Thickness (mm)", "minThicknessMm", "maxThicknessMm")}
        </details>
        <details className="filter-group">
          <summary>Commercial filters{commercial ? " · Applied" : ""}</summary>
          <p className="filter-help">
            Commercial filters require at least one matching seller listing.
          </p>
          <SupplierPicker
            label="Seller"
            value={draft.sellerSupplierId}
            onChange={(value) => set("sellerSupplierId", value)}
          />
          {field("maxMoq")}
          {field("maxMcq")}
          <p className="filter-help">
            Unknown MOQ / MCQ is excluded when its maximum is set. Choose a
            quantity unit to compare like units. No unit conversion is
            performed.
          </p>
          {select(
            "quantityUnit",
            units.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            )),
          )}
          {range(
            "Standard lead time",
            "minLeadTimeDays",
            "maxLeadTimeDays",
            true,
          )}
          {select(
            "listingStatus",
            <>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </>,
          )}
        </details>
      </form>
    </details>
  );
}

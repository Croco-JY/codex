import { useState } from "react";
import { useLocation } from "react-router";
import { Stack, Button } from "../ui";
import { isUuid } from "../features/admin-sources/model";
import { SupplierPicker } from "../features/materials/SupplierPicker";
import { MaterialDiscovery } from "../features/admin-catalog/Discovery";
import {
  ListingContext,
  ListingForm,
} from "../features/admin-catalog/Listings";
import "../features/admin-network/workspace.css";
export default function AdminListingsPage() {
  const loc = useLocation(),
    fixedMaterial = isUuid(loc.state?.curationMaterial)
      ? (loc.state.curationMaterial as string)
      : undefined,
    fixedSeller = isUuid(loc.state?.curationSeller)
      ? (loc.state.curationSeller as string)
      : undefined;
  const [mode, setMode] = useState<"material" | "seller">(
      fixedSeller ? "seller" : "material",
    ),
    [context, setContext] = useState(fixedMaterial ?? fixedSeller ?? ""),
    [create, setCreate] = useState(!!fixedMaterial || !!fixedSeller);
  return (
    <div className="provenance-workspace curation-network">
      <Stack>
        <header>
          <p className="eyebrow">PROTECTED CURATION</p>
          <h1>Listing context workspace</h1>
          <p>
            Choose a Material or Seller to load its bounded Listings. There is
            no global Listing directory.
          </p>
        </header>
        <div className="scope-actions">
          <Button
            disabled={create}
            onClick={() => {
              setMode("material");
              setContext("");
            }}
          >
            Material context
          </Button>
          <Button
            disabled={create}
            onClick={() => {
              setMode("seller");
              setContext("");
            }}
          >
            Seller context
          </Button>
          <Button disabled={create} onClick={() => setCreate(true)}>
            New Listing
          </Button>
        </div>
        {!context &&
          (mode === "material" ? (
            <MaterialDiscovery select={setContext} />
          ) : (
            <SupplierPicker
              label="Seller context"
              value={context}
              onChange={setContext}
            />
          ))}
        {context && (
          <section>
            <p className="record-reference">
              Selected {mode} context: {context}
            </p>
            <Button
              className="secondary"
              disabled={create}
              onClick={() => setContext("")}
            >
              Change Listing context
            </Button>
            <ListingContext
              key={`${mode}-${context}`}
              id={context}
              mode={mode}
            />
          </section>
        )}
        {create && (
          <ListingForm
            fixedMaterial={fixedMaterial}
            fixedSeller={fixedSeller}
            cancel={() => setCreate(false)}
          />
        )}
      </Stack>
    </div>
  );
}

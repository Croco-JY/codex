import { useState } from "react";
import { Button } from "../../ui";
import { PriceFacts } from "../commercial/PriceFacts";
import { PriceReads } from "../commercial/PriceReads";
import { InventoryReads } from "../commercial/InventoryReads";
import { PriceCreate, InventoryCreate, PriceSummary } from "./CreateForms";
import { PriceEvidence, PriceClose } from "./PriceManagement";
import { safePrice, type ListingContext, type SafePrice } from "./model";
export function CommercialWorkspace({
  listing,
  ready,
}: {
  listing: ListingContext;
  ready: boolean;
}) {
  const [selected, setSelected] = useState<SafePrice>();
  return (
    <>
      <section className="notice">
        <h2>Listing commercial facts</h2>
        <p>
          Price facts and Inventory observations have separate identities and
          evidence. Quantities are not summed. This workspace does not provide
          checkout, ATP, reservation or allocation.
        </p>
        {!ready && (
          <p role="alert">
            Current Listing context is unavailable or unsafe. Drafts are
            retained; writes are blocked.
          </p>
        )}
      </section>
      <PriceCreate
        listing={listing}
        ready={ready}
        select={(p) => {
          if (
            !selected ||
            selected.id === p.id ||
            window.confirm(
              "Discard selected Price evidence/close drafts and select another Price?",
            )
          )
            setSelected(p);
        }}
      />
      <PriceReads
        listing={listing}
        renderHistoryPrice={(raw, variants) => {
          const p = safePrice(raw, listing);
          return p ? (
            <>
              <PriceFacts price={p} variants={variants} />
              <Button
                className="secondary"
                onClick={() => {
                  if (
                    !selected ||
                    selected.id === p.id ||
                    window.confirm(
                      "Discard selected Price evidence/close drafts and select another Price?",
                    )
                  )
                    setSelected(p);
                }}
              >
                Manage Price · {p.id}
              </Button>
            </>
          ) : (
            <p role="alert">
              Price management unavailable: incomplete or unsafe Price state.
            </p>
          );
        }}
      />
      {selected && (
        <section className="admin-panel" aria-label="Selected Price management">
          <h2>Selected Price management</h2>
          <p>
            Loaded Price context. After a conflict, inspect the refreshed server
            state below before taking another action.
          </p>
          <PriceSummary price={selected} />
          <Button
            className="secondary"
            onClick={() => {
              if (
                window.confirm("Discard selected Price evidence/close drafts?")
              )
                setSelected(undefined);
            }}
          >
            Close selected Price workspace
          </Button>
          <PriceEvidence
            key={`evidence:${selected.id}`}
            price={selected}
            ready={ready}
          />
          <PriceClose
            key={`close:${selected.id}`}
            initial={selected}
            listing={listing}
            ready={ready}
            update={setSelected}
          />
        </section>
      )}
      <InventoryCreate listing={listing} ready={ready} />
      <InventoryReads listing={listing} />
    </>
  );
}

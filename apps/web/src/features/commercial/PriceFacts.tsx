import type { components } from "../../api/schema";
import { Facts, Reference } from "./ReadUI";
export type Variant = components["schemas"]["MaterialVariantView"];
export function variantName(id: string | undefined, variants: Variant[]) {
  return id
    ? variants.find((variant) => variant.id === id)?.variantName ||
        `Variant reference: ${id}`
    : "Material-level";
}
export function PriceFacts({
  price,
  variants,
  showSource = true,
}: {
  price: components["schemas"]["PriceView"];
  variants: Variant[];
  showSource?: boolean;
}) {
  return (
    <div className="price-fact">
      <p className="price-amount">
        {price.amount ?? "Amount not entered"}{" "}
        <span>
          {price.currency ?? "Currency unknown"} /{" "}
          {price.priceUnit ?? "Unit unknown"}
        </span>
      </p>
      <Facts
        values={[
          ["Price scope", variantName(price.materialVariantId, variants)],
          [
            "Tier minimum quantity",
            price.minimumOrderQuantity == null
              ? "Base price (no tier minimum)"
              : `${price.minimumOrderQuantity} ${price.priceUnit ?? "(unit unknown)"}`,
          ],
          ["Valid from (UTC)", price.validFrom],
          ["Valid to (UTC)", price.validTo ?? "No end recorded"],
          ["Observed at (UTC)", price.observedAt],
        ]}
      />
      {showSource && (
        <p>
          <Reference label="Source reference" value={price.dataSourceId} />
        </p>
      )}
    </div>
  );
}

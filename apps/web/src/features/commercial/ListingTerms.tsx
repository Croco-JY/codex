import type { components } from "../../api/schema";
import { SupplierLabel } from "../materials/SupplierPicker";
import { titleCase } from "../materials/MaterialSummary";
import { Facts, shown } from "./ReadUI";
export type Listing = components["schemas"]["ListingView"];
export function ListingTerms({ listing }: { listing: Listing }) {
  return (
    <Facts
      values={[
        [
          "Seller",
          listing.sellerSupplierId ? (
            <SupplierLabel id={listing.sellerSupplierId} />
          ) : (
            "Seller not recorded"
          ),
        ],
        ["Seller article", listing.sellerArticleNumber],
        ["Listing status", titleCase(listing.status)],
        ["MOQ", shown(listing.minimumOrderQuantity)],
        ["MCQ / minimum color quantity", shown(listing.minimumColorQuantity)],
        ["Quantity unit", shown(listing.quantityUnit)],
        ["Standard lead time (days)", shown(listing.standardLeadTimeDays)],
        [
          "Reproduction lead time (days)",
          shown(listing.reproductionLeadTimeDays),
        ],
      ]}
    />
  );
}

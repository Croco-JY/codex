import { decimal } from "./decimal";
import type { components } from "../../api/schema";
import type { References } from "./materialQueries";
import { SupplierLabel } from "./SupplierPicker";
export type Material = components["schemas"]["MaterialView"];
export const titleCase = (value?: string) =>
  value
    ? value[0] + value.slice(1).toLowerCase().replaceAll("_", " ")
    : "Not entered";
export function originLabel(id: string | undefined, references: References) {
  if (!id) return "Origin not entered";
  if (references.countries.isPending) return "Loading origin label…";
  const country = references.countries.data?.find(
    (country) => country.id === id,
  );
  return country?.nameEn || country?.nameNative || "Origin label unavailable";
}
export function Composition({
  material,
  references,
}: {
  material: Material;
  references: References;
}) {
  if (
    !material.compositionCompleteness ||
    material.compositionCompleteness === "UNKNOWN"
  )
    return <p className="composition">Composition not entered</p>;
  const parts = material.composition?.map((part, index) => {
    const fiber = references.fiberList.find(
      (fiber) => fiber.id === part.fiberTypeId,
    );
    return (
      <span key={part.fiberTypeId ?? index}>
        {index > 0 && " · "}
        {fiber?.nameEn ||
          fiber?.nameLocal ||
          part.fiberCode ||
          "Fiber label unavailable"}
        {part.percentage == null
          ? " — percentage not entered"
          : ` ${decimal(part.percentage) ?? part.percentage}%`}
      </span>
    );
  });
  return (
    <p className="composition">
      <span className="composition-state">
        {material.compositionCompleteness === "PARTIAL"
          ? "Known composition: "
          : "Complete composition: "}
      </span>
      {parts?.length ? parts : "Composition details unavailable"}
      {material.compositionCompleteness === "PARTIAL" &&
        " · remaining composition unknown"}
    </p>
  );
}
export function MaterialFacts({
  material,
  references,
}: {
  material: Material;
  references: References;
}) {
  return (
    <dl className="material-facts">
      <div>
        <dt>Catalog supplier</dt>
        <dd>
          <SupplierLabel id={material.catalogSupplierId} />
        </dd>
      </div>
      <div>
        <dt>Origin</dt>
        <dd>{originLabel(material.originCountryId, references)}</dd>
      </div>
      <div>
        <dt>Catalog article</dt>
        <dd>{material.catalogArticleNumber || "Not entered"}</dd>
      </div>
    </dl>
  );
}

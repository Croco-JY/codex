package com.sourceos.supplysearch;

import com.sourceos.facility.FacilityService;
import com.sourceos.shared.*;
import com.sourceos.supplier.SupplierService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Read-only cross-domain projection. All predicates are bound; no foreign entities are mutated. */
@Service
public class DirectorySearch {
  public record SupplierFilters(
      String country,
      SupplierService.Role role,
      SupplierService.Verification verificationStatus,
      String facilityCountry,
      UUID region,
      UUID cluster,
      UUID capability,
      String q) {}

  public record FacilityFilters(
      String country,
      UUID region,
      UUID cluster,
      FacilityService.Type type,
      UUID capability,
      UUID supplier) {}

  public record SupplierHit(
      UUID id,
      String displayName,
      String country,
      SupplierService.Verification verificationStatus,
      Instant createdAt) {}

  public record FacilityHit(
      UUID id,
      UUID supplierId,
      String name,
      String country,
      FacilityService.Type facilityType,
      UUID regionId,
      UUID industrialClusterId,
      Instant createdAt) {}

  public record Page<T>(List<T> items, String nextCursor) {}

  private record Anchor(Instant time, UUID id) {}

  private final JdbcClient jdbc;
  private final SupplierService suppliers;

  public DirectorySearch(JdbcClient jdbc, SupplierService suppliers) {
    this.jdbc = jdbc;
    this.suppliers = suppliers;
  }

  private String hash(Object filter) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(new tools.jackson.databind.ObjectMapper().writeValueAsBytes(filter)));
    } catch (Exception e) {
      throw new IllegalStateException("Cannot encode filter identity", e);
    }
  }

  private Anchor anchor(String cursor, String hash, int limit) {
    if (limit < 1 || limit > 100) throw ValidationRules.bad("Page size must be 1..100");
    if (cursor == null) return new Anchor(null, null);
    try {
      if (cursor.length() > 1024 || !cursor.matches("[A-Za-z0-9_-]+"))
        throw new IllegalArgumentException();
      var p =
          new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split("~", -1);
      if (p.length != 4 || !p[0].equals("created-desc") || !p[1].equals(hash))
        throw new IllegalArgumentException();
      return new Anchor(Instant.parse(p[2]), UUID.fromString(p[3]));
    } catch (IllegalArgumentException | java.time.DateTimeException e) {
      throw ValidationRules.bad("Invalid cursor or changed filters");
    }
  }

  private String cursor(String hash, Instant at, UUID id) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(
            ("created-desc~" + hash + "~" + at + "~" + id).getBytes(StandardCharsets.UTF_8));
  }

  private void country(String code) {
    if (code != null && !code.matches("[A-Z]{2}"))
      throw ValidationRules.bad("Country must be an ISO alpha-2 code");
  }

  public Page<SupplierHit> suppliers(SupplierFilters f, int limit, String cursor) {
    country(f.country());
    country(f.facilityCountry());
    if (f.q() != null && f.q().length() > 160) throw ValidationRules.bad("Search text is too long");
    String h = hash(f);
    var a = anchor(cursor, h, limit);
    boolean facilityFiltered =
        f.facilityCountry() != null
            || f.region() != null
            || f.cluster() != null
            || f.capability() != null;
    String sql =
        """
        SELECT s.id,s.display_name,c.alpha2,s.verification_status,s.created_at
        FROM supplier_profile s JOIN country c ON c.id=s.country_id WHERE s.status='ACTIVE'
        AND (CAST(:country AS text) IS NULL OR c.alpha2=:country)
        AND (CAST(:role AS text) IS NULL OR EXISTS(SELECT 1 FROM supplier_role r WHERE r.supplier_id=s.id AND r.role=:role))
        AND (CAST(:verification AS text) IS NULL OR s.verification_status=:verification)
        AND (CAST(:q AS text) IS NULL OR s.normalized_name LIKE :q OR EXISTS(SELECT 1 FROM supplier_alias x WHERE x.supplier_id=s.id AND x.normalized_alias LIKE :q))
        AND (NOT :facilityFiltered OR EXISTS(
        SELECT 1 FROM facility f JOIN country fc ON fc.id=f.country_id WHERE f.supplier_id=s.id AND f.status='ACTIVE'
        AND (CAST(:facilityCountry AS text) IS NULL OR fc.alpha2=:facilityCountry)
        AND (CAST(:region AS uuid) IS NULL OR f.region_id=:region)
        AND (CAST(:cluster AS uuid) IS NULL OR f.industrial_cluster_id=:cluster)
        AND (CAST(:capability AS uuid) IS NULL OR EXISTS(SELECT 1 FROM facility_capability x JOIN capability cap ON cap.id=x.capability_id WHERE x.facility_id=f.id AND x.capability_id=:capability AND cap.active))))
        AND (CAST(:at AS timestamptz) IS NULL OR (s.created_at,s.id)<(CAST(:at AS timestamptz),CAST(:anchor AS uuid)))
        ORDER BY s.created_at DESC,s.id DESC LIMIT :limit
        """;
    var rows =
        jdbc.sql(sql)
            .param("country", f.country(), java.sql.Types.VARCHAR)
            .param("role", f.role() == null ? null : f.role().name(), java.sql.Types.VARCHAR)
            .param(
                "verification",
                f.verificationStatus() == null ? null : f.verificationStatus().name(),
                java.sql.Types.VARCHAR)
            .param(
                "q",
                f.q() == null || f.q().isBlank() ? null : SearchText.like(f.q()),
                java.sql.Types.VARCHAR)
            .param("facilityFiltered", facilityFiltered)
            .param("facilityCountry", f.facilityCountry(), java.sql.Types.VARCHAR)
            .param("region", f.region(), java.sql.Types.OTHER)
            .param("cluster", f.cluster(), java.sql.Types.OTHER)
            .param("capability", f.capability(), java.sql.Types.OTHER)
            .param(
                "at",
                a.time() == null ? null : OffsetDateTime.ofInstant(a.time(), ZoneOffset.UTC),
                java.sql.Types.TIMESTAMP_WITH_TIMEZONE)
            .param("anchor", a.id(), java.sql.Types.OTHER)
            .param("limit", limit + 1)
            .query(
                (rs, n) ->
                    new SupplierHit(
                        rs.getObject("id", UUID.class),
                        rs.getString("display_name"),
                        rs.getString("alpha2"),
                        SupplierService.Verification.valueOf(rs.getString("verification_status")),
                        rs.getObject("created_at", OffsetDateTime.class).toInstant()))
            .list();
    boolean more = rows.size() > limit;
    var items = List.copyOf(rows.subList(0, Math.min(limit, rows.size())));
    var last = items.isEmpty() ? null : items.getLast();
    return new Page<>(items, more ? cursor(h, last.createdAt(), last.id()) : null);
  }

  public Page<FacilityHit> facilities(FacilityFilters f, int limit, String cursor) {
    country(f.country());
    if (f.supplier() != null) suppliers.read(f.supplier());
    String h = hash(f);
    var a = anchor(cursor, h, limit);
    String sql =
        """
        SELECT f.*,c.alpha2 FROM facility f JOIN supplier_profile s ON s.id=f.supplier_id JOIN country c ON c.id=f.country_id
        WHERE f.status='ACTIVE' AND s.status='ACTIVE'
        AND (CAST(:country AS text) IS NULL OR c.alpha2=:country)
        AND (CAST(:region AS uuid) IS NULL OR f.region_id=:region)
        AND (CAST(:cluster AS uuid) IS NULL OR f.industrial_cluster_id=:cluster)
        AND (CAST(:type AS text) IS NULL OR f.facility_type=:type)
        AND (CAST(:supplier AS uuid) IS NULL OR f.supplier_id=:supplier)
        AND (CAST(:capability AS uuid) IS NULL OR EXISTS(SELECT 1 FROM facility_capability x JOIN capability cap ON cap.id=x.capability_id WHERE x.facility_id=f.id AND x.capability_id=:capability AND cap.active))
        AND (CAST(:at AS timestamptz) IS NULL OR (f.created_at,f.id)<(CAST(:at AS timestamptz),CAST(:anchor AS uuid)))
        ORDER BY f.created_at DESC,f.id DESC LIMIT :limit
        """;
    var rows =
        jdbc.sql(sql)
            .param("country", f.country(), java.sql.Types.VARCHAR)
            .param("region", f.region(), java.sql.Types.OTHER)
            .param("cluster", f.cluster(), java.sql.Types.OTHER)
            .param("type", f.type() == null ? null : f.type().name(), java.sql.Types.VARCHAR)
            .param("supplier", f.supplier(), java.sql.Types.OTHER)
            .param("capability", f.capability(), java.sql.Types.OTHER)
            .param(
                "at",
                a.time() == null ? null : OffsetDateTime.ofInstant(a.time(), ZoneOffset.UTC),
                java.sql.Types.TIMESTAMP_WITH_TIMEZONE)
            .param("anchor", a.id(), java.sql.Types.OTHER)
            .param("limit", limit + 1)
            .query(
                (rs, n) ->
                    new FacilityHit(
                        rs.getObject("id", UUID.class),
                        rs.getObject("supplier_id", UUID.class),
                        rs.getString("name"),
                        rs.getString("alpha2"),
                        FacilityService.Type.valueOf(rs.getString("facility_type")),
                        rs.getObject("region_id", UUID.class),
                        rs.getObject("industrial_cluster_id", UUID.class),
                        rs.getObject("created_at", OffsetDateTime.class).toInstant()))
            .list();
    boolean more = rows.size() > limit;
    var items = List.copyOf(rows.subList(0, Math.min(limit, rows.size())));
    var last = items.isEmpty() ? null : items.getLast();
    return new Page<>(items, more ? cursor(h, last.createdAt(), last.id()) : null);
  }
}

# ADR 017: Account, canonical business and facility
Status: Accepted for Phase 1A.
Organization is a tenant/account, SupplierProfile is an independently discovered business and Facility is a site. SupplierProfile has no organization FK. Historical SupplierOrganizationLink permits multiple suppliers per account and at most one ACTIVE account link per supplier, enforced by a partial unique index. No claim or account-link mutation HTTP workflow in 1A. Linkage confers no canonical write permission. Existing supplier IDs survive future account adoption.

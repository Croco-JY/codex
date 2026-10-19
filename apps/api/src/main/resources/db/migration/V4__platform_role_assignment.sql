CREATE TABLE platform_role_assignment (
 id uuid PRIMARY KEY, issuer varchar(500) NOT NULL CHECK(length(trim(issuer))>0),
 subject varchar(255) NOT NULL CHECK(length(trim(subject))>0),
 role varchar(30) NOT NULL CHECK(role='PLATFORM_ADMIN'),
 status varchar(20) NOT NULL CHECK(status IN ('ACTIVE','REVOKED')),
 granted_by_issuer varchar(500) NOT NULL CHECK(length(trim(granted_by_issuer))>0),
 granted_by_subject varchar(255) NOT NULL CHECK(length(trim(granted_by_subject))>0),
 granted_at timestamptz NOT NULL DEFAULT now(),
 revoked_by_issuer varchar(500), revoked_by_subject varchar(255), revoked_at timestamptz,
 version bigint NOT NULL DEFAULT 0,
 CHECK((status='ACTIVE' AND revoked_at IS NULL AND revoked_by_issuer IS NULL AND revoked_by_subject IS NULL)
 OR (status='REVOKED' AND revoked_at>=granted_at AND revoked_at IS NOT NULL AND
 length(trim(revoked_by_issuer))>0 AND revoked_by_issuer IS NOT NULL AND
 length(trim(revoked_by_subject))>0 AND revoked_by_subject IS NOT NULL))
);
CREATE UNIQUE INDEX platform_active_grant_uq ON platform_role_assignment(issuer,subject,role) WHERE status='ACTIVE';

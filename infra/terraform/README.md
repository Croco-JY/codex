# Production infrastructure plan (not deployed)
VPC private subnets → ALB → ECS Fargate → RDS PostgreSQL 18 Multi-AZ.
CloudFront serves private S3 SPA assets; Cognito, Secrets Manager, KMS, CloudWatch and WAF.
No fabricated account IDs, providers or resources. Use private database/storage, TLS, explicit CORS and least-privilege IAM.
Delivery headers: CSP default-src 'self'; connect-src explicit API origin; frame-ancestors 'none'; HSTS max-age=31536000; X-Content-Type-Options nosniff; Referrer-Policy strict-origin-when-cross-origin; Permissions-Policy camera=(), microphone=(), geolocation=().
Before commercial launch validate restore drills: target RPO <=5 minutes, RTO <=1 hour.
Security CI rollout: dependency scanning, secret scanning, SAST, image scanning, CycloneDX SBOM and license report. CI foundation first; these are not claimed as implemented production controls.

# Foundation shell
Purpose: verify system readiness and organization context. Roles: authenticated organization members.
Primary action: select an existing organization. Secondary: create a real organization, rename if authorized.
Data: API health, authenticated identity and authorized organization list.
Loading: skeleton; empty: organization creation prompt; error: accessible message and retry.
Permissions: backend checks membership; organization selection never grants privileges.
Responsive: navigation wraps and content stacks. Keyboard focus and labels required.
Acceptance: real health visible; unauthenticated state explained; cross-tenant reads denied.

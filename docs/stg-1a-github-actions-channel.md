# STG-1A GitHub Actions runtime channel

This channel is a local implementation pending activation. It dispatches from
`main` and tests detached candidate
`230faf61e68d468d26db04b8e7130125e443b280` from
`refs/heads/stg-1a-java25-runtime`. The accepted candidate and its permanently
closed standalone Maven path stay intact. The reviewed default-branch
controller owns the independently authorized execution path.

## Configure independent approval

1. Create the GitHub Environment `stg-1a-runtime` explicitly. Configure custom
   deployment branch rules to permit only the branch `main`. Set required
   reviewers to designated individual users, enable prevention of self-review,
   and disable administrator bypass. The reviewer must be a non-admin with
   repository access, distinct from the dispatcher. This implementation rejects
   owner approval and settings that would permit self-review.
2. Supply `STG1A_REVIEW_TOKEN` as an Environment secret. Use a dedicated
   expiring, read-only credential scoped to this repository. Start with Actions
   read, Environments read and GitHub's implicit Metadata read. Verify it can
   read run and first-attempt details, jobs, approval history, Environment
   protection and branch rules, its named variable, effective collaborator
   permission, and the candidate ref. Confirm endpoint permissions against the
   actual token/account before activation. If a read requires additional scope,
   the repository owner should review the specific endpoint and grant only its
   required read access. Use no general write capability. The default workflow
   token retains only contents read, plus GitHub OIDC token issuance.
3. Put the reviewed policy JSON in the Environment variable
   `STG1A_RUNTIME_POLICY`. The controller reads it using the authenticated GitHub
   API. A local environment variable or file with the same name cannot change
   the policy. Record the Environment ID, exact reviewed controller commit,
   exact candidate commit, reviewer IDs, qualified runner profile hash, and
   measured capacity policy. Changes must be in place before a fresh dispatch.

The policy object uses the following keys. Angle-bracket values are schema
placeholders. They must be replaced by verified records before activation.

```text
environment_id        <numeric ID of stg-1a-runtime>
reviewer_ids          <array of numeric-reviewer IDs>
workflow_sha          <full approved commit on main>
candidate_sha         230faf61e68d468d26db04b8e7130125e443b280
runner_label          ubuntu-24.04
admin_bypass_disabled true
ryuk_enabled          true
ryuk_privileged       false
socket                /run/stg-1a/docker.sock
cleanup               ryuk-and-owned-inventory
profile_sha256        <SHA-256 of /etc/stg-1a/profile.json>
fixture_image         <digest-pinned linux/amd64 python:TAG@sha256:DIGEST>
storage.start         <per-path additional bytes and inodes before the workload>
storage.export        <per-path additional bytes and inodes before the OCI export>
reserve               <bytes and inodes to leave free on each underlying device>
```

Each `storage` phase must specify `workspace`, `maven`, `docker`, `oci` and
`evidence`. Each path entry and the reserve have positive integer `bytes` and
`inodes`. Include the isolated source copy, Maven cache, compiled output and
concurrent PostgreSQL data in the budget for their backing mounts.

The controller verifies GitHub JWT signatures with the official issuer and
JWKS, RS256, an exact audience and bounded time checks. It also binds the
repository and owner IDs, workflow ref and SHA, dispatch on `main`, Environment,
hosted runner and first run attempt to GitHub API evidence. GitHub's review
history is run-scoped. The controller requires attempt 1 and rejects reruns,
stale or changed policy, conflicting decisions and unverifiable data. It requires
one genuine approval recorded for the expected Environment from a configured
non-admin reviewer and confirms the reviewer's effective permission through the
API. GitHub's documented REST Environment response does not expose the admin
bypass toggle. The operator must disable it in settings and record that decision
in the authenticated policy. The recorded approval by an eligible non-admin
independently rules out an approval granted solely by an administrator bypass.
A missing permission, additional unexpected Environment rule, unavailable API
record or changed candidate ref blocks the job.

The approval trust boundary includes the GitHub repository administrators who
control `main` and Environment policy. Protect those settings and the controller
through repository review. A GitHub-hosted runner label identifies a VM class.
It does not give the workflow a qualified Docker policy.

## Qualify the runner before activation

Standard `ubuntu-24.04` is the initial runner label. GitHub documents **14 GB SSD**
for that runner. Start with an approved disposable qualification run and measure
a cold-cache full workload on an approved profile with adequate capacity.
Measure peak bytes and inode growth for the workspace, Maven cache and output,
Docker data root, OCI staging and evidence. Include the storage needed when the
PostgreSQL fixture, image layers and uncompressed OCI archive coexist. Account
for preinstalled tooling and leave a separate cleanup reserve. The controller
adds concurrent budgets for paths on the same device and samples low-water
marks during execution. It checks capacity before executing the workload and
again before OCI export. Missing measurements or insufficient space/inodes
block the run. If the standard runner fails qualification, record the measured
shortfall and obtain approval for a suitable profile before changing the label
and policy. The workflow does not remove preinstalled SDKs.

The default GitHub runner does not come with the profile required below.
Provisioning it via an independently reviewed GitHub-hosted runner bootstrap is
an activation prerequisite. Supply or commission that bootstrap through
platform review before publication. It may set up an isolated daemon and
policy on the disposable VM. It must not change the daemon policy to allow
privileged operations or route around the controller.

- A dedicated non-admin workload account named `stg1a-workload`, UID **10002**,
  can read the approved Java toolchain and use the fixed daemon socket. The
  controller runs as the distinct GitHub runner account. The workload user
  must be unable to access runner credentials, its home, sudo privileges,
  controller evidence and the default privileged Docker socket. The controller
  needs noninteractive sudo for its fixed workload-user launch and owned
  scratch setup/cleanup commands. Confirm candidate subprocesses cannot reach
  runner credentials through the process filesystem or through Docker.
- A dedicated, initially empty x64 Linux Docker daemon listens at
  `/run/stg-1a/docker.sock`. Its authorizer enforces no privileged containers,
  no host networking, no other host binds, and permits the exact Ryuk socket
  bind to `/var/run/docker.sock`. Qualify all required Docker calls and allowed
  image pulls, and test rejection of unauthorized operations in the policy's
  own offline test suite. Prevent access to an alternate daemon. The qualified
  Buildx builder must export single-platform OCI archives that this daemon can
  import with `docker image load`. An image-cache or platform compatibility
  issue blocks execution. A standard Docker CLI and an OIDC token alone cannot
  enforce the daemon restrictions.
- Under root-owned, non-writable directories, install
  `/etc/stg-1a/profile.json` with `schema: 1`, `workload_user:
  "stg1a-workload"`, `socket: "/run/stg-1a/docker.sock"`, the fixed absolute
  `docker_root`, `docker_authorizer` plugin name, storage `driver`, Buildx
  `builder` name and `docker_policy_sha256`. The matching policy bytes reside
  at `/etc/stg-1a/docker-policy.json`. Root owns the files and parent directories.
  The Environment policy pins the profile hash. The controller also compares
  the live daemon's authorizer, driver, data root and initial inventory with
  the qualified profile. Ensure the runner can measure the filesystem at the
  approved Docker data root.

Configure Testcontainers Java 2.0.5 using the clean Maven child environment
constructed by the controller. It sets
`TESTCONTAINERS_RYUK_CONTAINER_PRIVILEGED=false`, keeps Ryuk enabled, and supplies
only the reviewed local socket. The Java property is
`ryuk.container.privileged`, with default `true`. The shorter variable
`TESTCONTAINERS_RYUK_PRIVILEGED` does not select this Java property. A nonempty
correct environment override precedes home and classpath properties. The
controller additionally observes actual Ryuk `HostConfig.Privileged=false`,
its exact socket bind and successful Testcontainers cleanup. If Ryuk cannot
operate under the approved policy, stop and report the blocker. The profile
owns disposition of unlabelled pull and builder caches when the disposable VM
is destroyed. The controller removes only the immutable resources it created
and verified under the run label and never uses a global prune.

## Verification and evidence

The controller makes an isolated writable copy after checking the detached
candidate, then compares the tracked bytes before and after Maven.
It executes the exact Maven wrapper verification with Java 25 and checks
Maven 3.9.11, every expected Surefire class and the real expiry test. It hashes
the executable Spring Boot JAR. Buildx uses the API context and accepted
Dockerfile, verifies the Temurin base pin and checks the inherited layers of
the imported result. An OCI manifest digest and runnable image config ID
identify different objects and are recorded separately. The exact byte hash
of the image's JAR must match the build output.

The runtime suite uses a digest-pinned PostgreSQL 18.3 instance and a
digest-pinned Python HTTPS OIDC discovery/JWKS fixture. All services stay inside
a job-specific internal bridge. The certificate for the synthetic fixture is
installed into an API-instance truststore with hostname verification enabled.
The running Java process must be PID 1 with UID and GID 10001. The probes check
the configured port, V1–V23, readiness before and after database disconnection,
continued liveness, missing database/issuer/audience failures, wildcard CORS
failure, and HTTP 401 both anonymously and with only the development header.
The shutdown case requires the graceful completion log, exit within the
timeout, exit status 0 or 143, and no OOM. Any mandatory missing or inconsistent
assertion blocks the success verdict. Cleanup uses inspected IDs and ownership
labels and checks removals after requesting them.

Workflow artifacts in this public repository are public evidence. The upload
contains `result.json` and `sha256.json` only. The report includes the two
commits, approval history reference, run/attempt, approved reviewer identity,
runner and capacity facts, verified Java/Maven/Surefire data, JAR and OCI
provenance, assertion results and cleanup. Blocked runs list blockers and
skipped stages. The controller keeps raw command output, test credentials,
tokens, JARs and private fixture files out of uploaded artifacts. Verify the
hash, exact run identity, review history and all stage outcomes independently
before accepting runtime verification. Offline tests use mock GitHub responses,
locally generated test keys and command/filesystem doubles.

## Publish and activate after approval

1. Confirm the owner has authorized the effects of `SOURCE OS CI` on opening a
   PR, merging the reviewed controller or publishing a ref. Its existing
   `push` and `pull_request` triggers execute Maven directly. If those executions
   are disallowed, obtain a separate, explicit publication plan before creating
   any of those events. Leave the existing workflow and settings alone until
   that decision is made.
2. Configure and verify the Environment, eligible independent reviewer,
   read-only API credential, Docker profile, and capacity measurements.
3. Independently review the controller, workflow, policy and full offline suite.
   Confirm publication can include the exact candidate without merging Phase 3G.
4. Publish the staging branch at `230faf61e68d468d26db04b8e7130125e443b280` using
   the approved publication plan and verify the server's ref. Publish only the
   approved controller change to `main`, where `workflow_dispatch` is registered.
5. Verify the published workflow SHA, set the authenticated policy to that exact
   commit, and confirm the candidate and policy values before dispatch. Trigger
   the workflow on `main`. The other designated reviewer approves the protected
   job. Collect the exact first attempt's evidence and obtain independent review.
   For another attempt use a fresh dispatch and approval.

The local implementation has no approval, publication or execution authority
for the future workflow. The STG-1A P1 source correction remains accepted.
IR-DF02-01 independent review remains incomplete. 3G-DF-02 remains ineligible
for closure. Phase 3G remains paused at defect-stop.

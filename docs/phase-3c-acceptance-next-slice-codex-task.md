# SOURCE OS — Codex Master Task v3.0
## Phase 3C Independent Acceptance Review → Next Slice Decision → Execution Specification

**상태:** 이번 작업은 독립 검수 및 문서 작성만 허용. 구현·DB 변경·후속 slice 실행은 승인하지 않는다.
**검수 대상:** `Croco-JY/codex` / `phase-3-pattern-operations` / `7381303483644ba875305b413d7e3d6047f70aa1`.
**기준선:** `main@41c629cce3bcdf5abf776cf33784631a4e150667` V1~V17, Phase 3 브랜치의 V18 Measurement, V19 Pattern, V20 Pattern Artifact.
**3C 단독 diff 기준:** `cfd4b2e02dc97b4ccb356339cfa0352266e59639...7381303483644ba875305b413d7e3d6047f70aa1`.
**검증 실행:** SOURCE OS CI `40185095517` / push / attempt 1 / exact HEAD / completed success. 그 이후 현재 상태가 달라졌다면 사실을 재조회하여 보고한다.
**참조:** `docs/phase-3-plan.md`, `docs/phase-3a-measurement-foundation.md`, `docs/phase-3b-pattern-vault.md`, `docs/phase-3c-pattern-artifacts.md`, `docs/adr/012-pattern-revision-model.md`, V18~V20 migration 및 Java/React 소스/테스트; 3D 후보 `spec/phase-3d-grading-contract@ffc2c785226d91c8dc05fe00938b4ac8a4442c17` 의 `docs/phase-3d-grading-contract.md`. 마지막 문서는 미승인 초안이지 현재 실행 권한이 아니다.

## 0. 최상위 명령과 금지사항

한 번의 검토 작업을 순서가 있는 세 단계로 수행한다.

**A. Phase 3C Independent Acceptance Review → B. Next Slice Decision → C. Selected Slice Execution Spec Draft**.

- A에서 **기술적 차단 결함이 발견되면 Defect-Stop**. 재현, 위치, 심각도와 최소 수정안을 보고하고 B/C는 실행하지 않는다.
- A의 기술 검수가 통과하더라도 **repository-wide open PR=0 조건이 남으면 정식 ACCEPT는 금지**한다. 외부 절차 차단으로 분리 표시하고, B/C는 **조건부 기획 초안**까지만 진행한다. 이는 V21 구현 승인이 아니다.
- 실제 코드를 수정하지 않는다. V1~V20 DDL/트리거·기존 프로젝트 소스·테스트·설정·빌드 산출물·OpenAPI·lockfile·CI·infra를 수정하거나 테스트 assertion/timeout을 약화하지 않는다.
- 새 V21+ migration, Geometry/Parser, Grading 런타임, Queue/Worker, Reconciliation/GC, Billing/Ledger, BYOS, Guest, RFQ, AI, Release, CAS, 특정 스토리지 공급자 결합을 구현하지 않는다.
- 기존 PR을 임의로 close/merge/rebase/edit하지 않는다. **새 PR도 만들지 않는다.** 작업 브랜치에 문서만 저장할 수 있고, 이미 존재하는 구현 브랜치를 오염시키지 않는다.
- 증거를 얻지 못하면 `NOT_VERIFIED`라고 기록한다. 테스트를 직접 실행하지 않았는데 직접 실행했다고 말하지 않는다. CI 성공과 독립 검수 완료는 다르다. 속도보다 정확성과 재현성이 우선이다.
- 소스에서 계약 위반이 발견되면 한 줄의 임의 수정도 하지 말고 정식 Defect-Stop 절차를 적용한다.

## 1. 환경과 스냅샷 확보 (read-only)

시작에 반드시 GitHub Remote, local, origin을 독립 확인하라.

1. `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git rev-parse origin/phase-3-pattern-operations` 및 live GitHub branch HEAD. 가능하면 검수용 별도 깨끗한 worktree 사용; 작업 중인 메인 checkout 변경 금지.
2. `git fetch`가 가능한 경우에도 작업 트리를 덮어쓰거나 reset하지 않는다. 원격 접근 실패/401/403은 인증·환경 이슈로 명시하고 다른 인증 없이 결과를 추정하지 않는다.
3. Phase 3 branch가 목표 SHA에서 이동했다면 조용히 최신 HEAD로 기준을 바꾸지 말고 `TARGET_DRIFT`로 표시하라. 명시된 SHA를 먼저 검수하고 변경사항을 별도 비교한다.
4. `git diff --name-status cfd4b2e02dc97b4ccb356339cfa0352266e59639 7381303483644ba875305b413d7e3d6047f70aa1`와 migration inventory. 현재 보고상 정확히 38개 파일, 신규 migration은 V20 한 개. V1~V19는 byte-identical, V21+ 없음 — **검증할 주장이지 미리 통과 처리할 사실이 아니다**.
5. 저장소 **전체** open PR 목록을 실시간 페이지네이션으로 조회한다(`gh pr list --state open --limit 100 --json number,title,headRefName,baseRefName,isDraft,url,createdAt` 또는 해당 GitHub REST API). 브랜치별 PR 수와 별개다. 조사 시작과 종료 시점 모두 기록한다.
6. 예상 주의사항: 이전 PR #5는 종료되었고, **문서 전용 Draft PR #6** (`docs/phase-3c-commercial-boundary-correction` → `phase-3-pattern-operations`)이 외부 작업으로 열려 있을 수 있다. 이는 3C 구현 diff에서 기인한 코드 결함이 아니다. 실제 현재 상태, 생성 시점, head/base, 변경 파일·원인을 확인하고 **기술 결함/절차 차단/외부 상태 변화로 구분**한다. 열린 PR을 조용히 무시하거나 임의로 닫지 않는다.

### PR gate 판정 표준

- `repoOpenPrCount=0`: 절차 게이트 충족.
- `repoOpenPrCount>0`, 모두 검수 대상 외 다른 브랜치: `PROCESS_BLOCKED_EXTERNAL`. 3C TECHNICAL_PASS는 가능하지만 FINAL_ACCEPT는 불가.
- 3C 대상 구현 PR 또는 이번 대상과 충돌하는 PR: 별도 내용/충돌 위험 평가 후 `PROCESS_BLOCKED_RELEVANT`.
- PR 목록 조회 불가: `PR_GATE_NOT_VERIFIED`. '0'이라고 추정 금지.
- 처리 권고는 제시하되, PR 변경은 운영자 별도 승인 필요. 외부 PR 때문에 3C 코드 실패로 판정하지 않는다.

## 2. Phase 3C 독립 검수 매트릭스

각 항목에 반드시 `PASS / FAIL / NOT_VERIFIED`, 대상 파일/함수·테스트/로그, 정확한 commit, 재현 절차 또는 한계를 기록한다. 기존 완료 문서만 요약해서 복사하지 말고 **실제 구현 소스와 테스트 증거를 대조**한다.

### 2A. 스키마·Revision 불변성 / Upgrade

- V20 `pattern_revision.artifact_expected boolean NOT NULL DEFAULT false` 추가가 기존 V19 UPDATE 방어 트리거 정의/enable 상태와 이전 row들을 보존하는지.
- `pattern_artifact`: 한 `pattern_revision_id`당 0/1, `storage_object_id` 고유, 같은 Style 소유권 복합 FK, 허용 `declared_format` DXF_AAMA/DXF_ASTM/PDF, 크기 1..10,485,760, SHA-256 hex·probe_version, 상태 `PENDING/READY/FAILED` 및 failure_code 관계 확인.
- 기존 artifactless PatternRevision에 retrofit 불가; 새 artifact-bearing Revision은 동일 TX의 예상 Artifact를 요구; 기존 V17 Reference와 의미/생명주기가 다르며 혼합하지 않음.
- DB 직접 UPDATE/DELETE/TRUNCATE, 이력 변조, 중복 삽입, 유효하지 않은 전이, fake READY 또는 terminal 재전이 거부.
- `V19→V20` 실제 데이터가 존재하는 upgrade와 fresh V20 schema 검증, 이전 V1~V19 마이그레이션 파일 변경 0, 과거 승인 트리거 변경 0. 최신 schema inventory는 검증 대상: 20 migrations, public base tables 53(Flyway 포함), application tables 52.

### 2B. 비-XA 업로드·동시성·실패 보존

- 단계 순서: ① 사전 권한·아카이브 검증 ② bounded file buffering / PDF·DXF envelope probe / SHA 계산 ③ TX1: Project→Style→Pattern lock, expected-head 검증, 새 Revision과 PENDING Artifact 및 audit 원자 커밋 ④ 트랜잭션 **밖**의 `AuthorizedStorage.putNew`(create-only, server UUID) ⑤ `AuthorizedStorage.get` read-back length+SHA ⑥ TX2: 권한·부모 상태 재확인, **정확한 Revision** PENDING→READY/FAILED 및 audit 원자 커밋.
- TX1/IO/TX2에 SQL 트랜잭션이 걸쳐 있지 않은지(`Propagation.NEVER`와 Spring proxy 경계); IO 중 장시간 Project/Style/Pattern 잠금 없음.
- 업로드 권한 철회/부모 archive는 STORAGE_* 실패로 위장하지 않음. 원격 IO IOException, 부분 쓰기, read-back 불일치, final audit rollback, crash, response loss, 권한 변경에서 메타데이터·파일 보존 상태가 실제 코드와 테스트에서 일치하는지.
- READY는 성공적 저장/최종화 의미일 뿐 CAD conformance, QA 승인, 제조용 승인을 뜻하지 않음.
- Artifact N+1 저장 중 별도 Pattern metadata N+2가 생성돼도 정확한 N+1 READY 최종화 가능; stale-head 동시 제출의 승자 1명/409 loser, loser audit 없음.
- 명시적인 사용자 재조회/재조정 없이 클라이언트·서버가 모호한 실패를 재전송·재생성하지 않음. 자동 복구/GC·스토리지 객체 리유즈가 없는 것은 명시적으로 *보류된 운영 리스크*이지 숨겨진 성공으로 서술 금지.

### 2C. Multipart / Probe / HTTP

- `metadata` 정확히 1개(UTF-8 application/json, 1..16384 bytes), `file` 정확히 1개. 중복/누락/여분 파트 거부, unknown JSON field/duplicate key/trailing token/형식 오류 거부.
- 0 byte 파일 400, 정확히 10,485,760 byte 경계 201 READY, 10,485,761 byte 413; 과한 요청의 새 Revision/Artifact row·storage write·upload audit 모두 0인지 실제 Servlet HTTP 테스트로 검증.
- PDF `%PDF-` 시작/`%%EOF` 끝, DXF text envelope/`SECTION`/`EOF`/pair/line limits 검증. 내용 검사는 **format correctness, CAD geometry, malware-safe 인증이 아니다**.
- 원본 파일명과 multipart MIME을 신뢰해 저장 경로·권한·무결성을 구성하지 않음.

### 2D. Tenant·Download Integrity

- Actor→requested Org Membership→Project→Style→Pattern→Revision→Artifact의 순서. OWNER/ADMIN 쓰기, VIEWER/보존된 archive 부모에서 권한 있는 READY download 가능; PLATFORM_ADMIN도 요청 Org membership 없으면 private bypass 금지.
- 비허가 Organization 403, 소속 승인 후 잘못된 nested ID/cross-tenant는 scoped 404, active-parent write 409, 비-READY 409 등 계약과 에러 순서 점검.
- 다운로드에서 READY만 Storage를 읽고 모든 GET에서 size+SHA 재검증. bytes missing/IO/readable-but-corrupt/same-length-corrupt 시 safe 409 및 파일 bytes 노출 0.
- `Content-Disposition` UTF-8 filename, `application/octet-stream`, `nosniff`, `Cache-Control: private, no-store` 확인; bare `storage_object_id` 다운로드 라우트·URL 없음. SHA·object UUID·raw issuer/subject·token을 사용자 응답/공유 감사 로그에 노출하지 않음.
- 파일 무결성 SHA만으로 작성자 신원, 서명, 법적 증빙, 계약 baseline이 완성됐다고 단정 금지.

### 2E. Frontend Lazy Budget / Session Isolation

- 기본 StyleDetail은 기존 Phase 2 네 sibling(Requirement, Material Selection, Facility Candidate, Development Reference)만 요청. Artifact 기본 추가 GET=0.
- Pattern 목록/상세/이력/Import 열기만으로 artifact list/detail/content 선조회 0; 명시적 Inspector는 metadata 1회·content 0; 실제 사용자가 Download를 눌렀을 때만 bytes 1회.
- 403 workspace denial, VIEWER 읽기전용, archived 상태 읽기, 한 child의 500이 다른 성공 sibling을 가리지 않음.
- 409/5xx/network/error/malformed201 업로드 모호성에서 원본 File·초안 유지, automatic resend=0, 명시적 history refresh/충돌 조정 후 사용자가 새로 제출.
- A→B, ABA, Actor change, 늦게 도착한 GET/mutation/binary response가 새로운 org/Actor draft 또는 다운로드 클릭을 오염시키지 않음. Blob URL/revocation, browser private storage leak 금지.
- 1440/820/768/390에서 document overflow 0 및 사용 가능한 키보드/레이블/텍스트 상태. 시각·WCAG 인증을 근거 없이 주장하지 않음.

### 2F. CI·Contract·Delivery Evidence

- CI `40185095517`의 event=push, attempt=1, head_sha 정확히 `7381303483644ba875305b413d7e3d6047f70aa1`, completed/success. 모든 노출 Job/Step 상태 검증. 에러 로그 접근 불가 시 그렇게 보고.
- 결과 재확인 목표: full backend 927 failures/errors/skips 0; focused backend 160; Vitest 1454/34 files; focused frontend 77; Playwright same-origin 98, separate-origin 98; TS typecheck/build, Terraform fmt/init/validate, diff check, Gitleaks 발견 0, responsive captures 72. CI가 직접 실행하지 않은 하위 항목은 완료 문서의 로컬 보고로 분리하고 원격에서 검증되지 않았음을 표시.
- `docs/openapi.json` SHA `51950e2dcbb4a6daf4c64ead980a8f86c09dad39008e69ba0fdecc1e450f7dfe`; `apps/web/src/api/schema.ts` SHA `e133411d080e4ab4b5857be3817b700d5d177ba272716a78acf75930c3e8f776`. 두 번 exporter 일치, baseline 기존 path/schema 삭제/수정 0, 3개 경로·6개 schema만 추가된 결과를 증거로 확인.
- 코드·DDL·설정·CI를 바꾸지 않고 리뷰만 했다는 최종 diff를 첨부한다. 테스트 실행으로 생긴 비추적 파일은 기존 작업물과 구분하여 보고; 임의 삭제/정리 금지.

## 3. 리뷰 판정 체계와 Defect-Stop

**Technical verdict(별도)** = `PASS` | `FAIL` | `INCONCLUSIVE`.
**Process verdict(별도)** = `CLEAR` | `BLOCKED_EXTERNAL_PR` | `BLOCKED_RELEVANT_PR` | `NOT_VERIFIED`.
**Formal acceptance** = `ACCEPT` | `CONDITIONAL_ACCEPT_PENDING_PROCESS` | `REJECT_DEFECT` | `HOLD_INSUFFICIENT_EVIDENCE`.

판정 규칙:
1. 기술 체크 중 계약 위반 재현 또는 명확한 코드 결함 발견 → `Technical FAIL` / `REJECT_DEFECT`, B/C 중단. 가장 작은 deterministic reproducer, 실제/기대 상태, 영향·심각도, 최소 수정안, API/DDL/보안 영향만 문서화. 생산 코드 수정 금지.
2. 기술 증거 부족 → `INCONCLUSIVE / HOLD_INSUFFICIENT_EVIDENCE`; 증거 없는 PASS 금지. 후속 slice는 방향 의견만 허용, 실행 spec을 확정하지 않음.
3. 기술 PASS + 모든 절차 CLEAR → `ACCEPT` 후보. 최종 수락 권한은 사용자/독립 리뷰어에 있다; Codex 혼자 승인했다고 선언하지 않는다.
4. 기술 PASS + repository-wide open PR>0의 외부 상태 → `CONDITIONAL_ACCEPT_PENDING_PROCESS`. **3C 코드 FAIL이 아니다**. 외부 PR 처리는 별도 승인 권고. B/C는 `PROVISIONAL/DRAFT`로 작성 가능하지만 승인·구현·V21 시작 금지.
5. PR 상태가 후속에 변해도 검수 당시·최종 시점 각각 보존. 사실관계의 날짜/시각(UTC)을 기록.

## 4. 다음 slice 선택 — 기술 검수 통과 시에만

Phase 3C 기술 PASS일 때만 다음 중 하나를 **명시적으로 비교·권고**한다.

**A. Geometry/Parser Decision ADR — 문서 전용**
- 실제 패턴 CAD 형상의 곡선/피스/좌표/사이즈 변환을 다음 필수 가치로 보는 경우, parser/geometry workload evidence가 아직 부족하면 이 경로가 우선이다.
- 실물 DXF-AAMA/ASTM, 제조사별 편차, 라이선스, 단위/좌표/곡선·노치·grainline 지원, malformed/zip bomb/input safety, CPU·RAM·런타임, 10MiB 제한의 근거를 수집하고 ADR만 작성.
- `No parser runtime / no worker / no queue / no geometry tables / no new migration`. V20 유지.

**B. Phase 3D POM Grading Execution Specification — 실행 명세만 작성**
- 제품 목표가 **Measurement 기반 Size Range / POM별 signed delta / 정확한 계산 및 Revision 이력**이고 CAD 실형상 확대·축소를 요구하지 않을 때 우선.
- 기존 초안 `spec/phase-3d-grading-contract@ffc2c785226d91c8dc05fe00938b4ac8a4442c17` 검증. 이는 미승인 초안이며 V21 구현 권한이 아니다.
- 정확한 V18 Measurement source, 같은 Style optional V19 Pattern pin, GradeRuleSet/Revision, size/transition completeness, BigDecimal string numeric, stale-head, audit, lazy UI, SQL·테스트 게이트를 정의. V21은 **향후 별도 승인 시에만** 사용 가능한 후보 migration 번호.

**선택 기준 표:** 고객에게 필요한 즉시 가치, 현 저장소의 참조 가능 데이터, 실제 픽스처·보안 증거, 스키마/운영 복잡도, 독립 검증 가능성, 사업 수익화와의 연결, 기존 계약에 대한 변경 위험. 후보별 `Evidence available / Missing evidence / Decision / Blocking assumptions` 필수.

결론에서 "3D를 권고"할 수는 있으나 POM Grading을 CAD Geometry Grading이라고 표시하지 말 것. Geometry 선행이 필요하다고 결론 나면 3D Implementation spec을 억지로 작성하지 말 것. 이후 QA/Release/Yield/BOM/Entitlement/BYOS/Guest/RFQ를 몰래 포함하지 않는다.

## 5. 선택된 slice의 Codex 실행 명세 작성 (코드 실행 금지)

B에서 한 가지 방향을 고른 후 `DRAFT — NOT APPROVED` 실행 스펙을 작성한다. *실행 명세 작성*은 실제 코드를 실행한다는 뜻이 아니다.

실행 명세에 포함할 필수 구조:
1. 정확한 baseline SHA/승인 관계/현재 PR gate/3C acceptance evidence와 명시적인 시작 승인 조건.
2. 목표·Non-goals, 성공 기준, 현 코드와 맞는 module ownership, immutable domain reference·DB FK/lock order.
3. 제안한 slice의 정확한 DB schema/constraints/migration 후보(필요 시), API DTO·에러 우선순위·pagination, 프런트 요청 budget, 기존 3C 프로토콜 비침범.
4. 실패/동시성/ambiguity/되돌리기 불가 상태·원장 아닌 audit 정책, 2 Organizations + VIEWER/ADMIN/OWNER/PLATFORM_ADMIN 보안 매트릭스.
5. 증거 기반 fixture/golden tests, SQL upgrade and direct-DML negative tests, CI·OpenAPI/generator·E2E·Accessibility, 무수정 기존 Phase 0~3C 회귀 기준.
6. 구현 순서를 DB → backend → OpenAPI/gen client → UI → tests로 정렬하되, 개발 중 발견된 현행 결함은 **Defect-Stop**으로 별도 분리.
7. 해당 slice 승인과 구현 시점을 다시 사용자에게 요청하는 명확한 **STOP** 규칙. 다른 slice 선행 구현 금지.

3D를 고른 경우: `docs/phase-3d-grading-execution-draft.md` 를 작성. 별도 함수형 POM 산술만 구현한다는 것을 명확히 쓰고 실물 CAD geometry를 호출하지 않는다. 예정 테이블 `grade_rule_set`, `grade_rule_set_revision`, `grade_size`, `grade_delta` 의 DB completeness/immutability 대안과 최악 500POM×15 transitions=7500 rows 비용을 평가하되, 최종 DDL은 승인 전 provisional. 검토 초안의 2..16 SizeRange cap, Pattern pin consistency, unit/overflow/error semantics를 확정 전 이슈로 드러낸다.

Geometry/Parser ADR을 고른 경우: `docs/geometry-parser-architecture-decision-draft.md` 를 작성. 실제 fixture와 워크로드 데이터가 없다면 결정값은 `EVIDENCE_REQUIRED` 이고 런타임 설계를 확정하지 않는다. 코드·DDL 계획서가 아니라 evidence acquisition/선택 기준·보안 위협모델 중심으로 작성한다.

## 6. 산출물 경로와 저장 정책

검수는 `7381303483644ba875305b413d7e3d6047f70aa1`의 정확한 기존 구현 코드를 읽기 전용으로 분석한다. 결과 문서는 사용자 또는 본 작업 전용의 **분리된 문서 브랜치**에만 저장한다. 검수 대상 `phase-3-pattern-operations` 또는 `main` 브랜치를 수정하지 않는다.

요구 산출물:
- `docs/reviews/phase-3c-independent-acceptance.md` — 체크리스트, ref/SHA, 정확한 근거 링크, PR 출처, 두 종류 verdict, Formal verdict, 미검증 항목, blocker/Defect-Stop.
- `docs/reviews/next-slice-decision.md` — B 단계 선택 기준·대안 비교·선택 근거·가정/차단 요인.
- `docs/phase-3d-grading-execution-draft.md` 또는 `docs/geometry-parser-architecture-decision-draft.md` — 선택된 C 단계의 **미승인 실행 문서**.

B/C 진행 불가 시 첫 보고서만 만든다. 결과 문서로 새로운 PR을 생성하지 않는다. 문서 commit/branch는 독립 추적 가능하도록 작성하되, 검수 대상 commit의 SHA나 Open PR 개수를 숨겨 바꾸지 않는다. 이미 기획용 PR #6 또는 다른 설계 브랜치가 있다면 합치거나 닫지 않는다.

## 7. 최종 사용자 보고 형식

보고서는 다음 순서와 용어를 지켜라:

1. **검수 고정점:** Repository / branch / inspected SHA / live SHA / CI run+attempt+conclusion.
2. **GitHub PR gate:** 전체 PR 숫자, PR별 용도·생성/업데이트 맥락, `3C defect vs external state` 판정, 조치 여부(무변경).
3. **3C 기능 매트릭스:** V20, immutability, non-XA, authorization, download SHA, multipart/probe, frontend lazy budget, CI/OpenAPI, 회귀. 각 항목 PASS/FAIL/NOT_VERIFIED와 파일·테스트 증거.
4. **Verdicts:** Technical / Process / Formal, 미확인 리스크 및 치명적 결함 여부.
5. **Next slice recommendation:** A vs B 비교, 선택 이유, 미충족 전제.
6. **실행 명세 산출:** 작성된 문서 파일 경로와 구체적으로 어떤 승인을 받아야 구현 가능한지.
7. **Diff·중단 증명:** 코드 0, migration 0, 기존 API 0, 새 PR 0, 현재 열린 PR 상태, 구현 미시작.

**마지막 명령:** 검수·문서가 완료되면 STOP. Phase 3D/Geometry/V21/QA/Release의 실제 구현, PR 생성, 기존 PR 종료, 메인 병합은 사용자 별도의 명시적 승인 전까지 수행하지 않는다.

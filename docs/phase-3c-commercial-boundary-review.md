# SOURCE OS — 사업 아키텍처 정렬 및 Phase 3C 기술 경계 교정안 (v2.0)

> **상태: 기획자 공유용 아키텍처 피드백 / 문서 전용 / 코드·DDL·API 변경 승인 아님**  
> 검증일: 2026-10-25  
> 실제 저장소 기준: `Croco-JY/codex` `main@41c629cce3bcdf5abf776cf33784631a4e150667`(V1~V17) + `phase-3-pattern-operations@7381303483644ba875305b413d7e3d6047f70aa1`(V18~V20).  
> Phase 3C 브랜치 exact-HEAD GitHub Actions [40185095517](https://github.com/Croco-JY/codex/actions/runs/40185095517): completed/success. **독립 검수·채택·main 병합과는 별개**. 기존 Phase 3C 계획은 'implemented pending independent review'로 기록됨.

## 0. 최종 결정 요약

1. **현재 3C 구현 경계는 V20에서 STOP.** V18=Measurement Revision, V19=Pattern Revision, V20=Pattern Artifact는 이미 개발 브랜치에 구현되었다. 번호를 새 기능에 재배정하지 않으며 V21+ 설계를 현 단계 DDL로 끼워 넣지 않는다.
2. **No Speculative Infra**: Pricing/Entitlement/Usage Ledger, Guest/RFQ, BYOS, Signal Analytics, AI parser/queue, geometry, CAS, GC/reconciliation worker 등을 지금 구현하거나 3C의 현재 불변 데이터를 갈아엎지 않는다. 장기 방향은 별도 ADR/로드맵으로만 관리한다.
3. **Pattern은 순수한 불변 개발 증거**다. V17 일반 참고 파일과 분리하고, 새 PatternRevision 생성 시 아티팩트 연계를 결정한다. 기존 리비전에 파일을 나중에 덧붙이거나 READY/FAILED를 제자리 재시도하지 않는다.
4. **Yield/BOM/Costing은 후속 독립 결과 스냅샷**이다. 패턴에 요척·마커 효율·원가 칼럼이나 예약 FK 슬롯을 지금 추가하지 않는다. 후속 불변 결과는 명시적으로 고정된 입력/단위/가정/버전을 참조한다.
5. **BYOS의 '기존 Facility 한 테이블 + visibility_scope'는 확정하지 않는다.** 단일 논리 인터페이스는 유용하지만 글로벌 카탈로그와 테넌트 비공개 객체의 실제 물리적 저장·제약은 별도 검증/ADR 후 선택한다.
6. **Release 계약 해시와 Guest RFQ, 데이터 집계는 후속**. SHA-256은 3C의 파일 바이트 무결성이지 법률상 계약 완성, 플랫폼 우회 방지, 익명성 증명은 아니다.

## 1. 팩트 체크와 피드백의 오류 교정

| 항목 | 코드베이스에서 확인된 내용 | 교정 |
| --- | --- | --- |
| 기준 브랜치 | main은 V1~V17. 별도 `phase-3-pattern-operations` 브랜치에 V18/V19/V20과 3A/3B/3C 코드/문서 존재 | `main V1~V17만이 현재 전체 진행 상태`라고 기술 금지 |
| V18 | `V18__measurement_revision.sql`: MeasurementSpec/Revision/Point | 번호 재사용·왜곡 금지 |
| V19 | `V19__pattern_revision.sql`: Pattern/PatternRevision. immutable revision, same-Style Measurement FK | Pattern 비즈니스 내용 기존 UPDATE 금지 |
| V20 | `V20__pattern_artifact.sql`: artifact_expected(immutable), PatternArtifact 테이블·SHA·상태 | V20 한도 내에서 새 메타데이터/과금/BYOS 테이블 추가 금지 |
| V17과 구분 | `style_development_reference`는 참고자료·DETACHED 가능 상태이고 `pattern_artifact`는 exact PatternRevision 전용 | 단순 파일 재활용으로 다루지 않음 |
| 현재 3C | 3C는 구현·local 검증·exact SHA CI 성공, 문서상 외부 독립 리뷰 대기 | '미구현'도 '최종 승인/통합 완료'도 아님 |

3C의 실제 계약: `pattern_artifact`에 `pattern_revision_id`(UNIQUE), `style_id`, `storage_object_id`(UNIQUE), `declared_format`(DXF_AAMA/DXF_ASTM/PDF), `display_name`, `size_bytes`(1..10MiB), 비공개 `sha256`(64자 lowercase hex), `probe_version`, `state`(PENDING/READY/FAILED), `failure_code`, version/timestamps가 있다. V20은 기존 V19 UPDATE 차단 트리거를 보존한다. 아티팩트가 필요한 새 Revision을 만들 때 동시 예약하며, 예전 artifactless Revision은 후속 업로드를 받을 수 없다.

3C의 동기식 경로: **사전 권한검사 → 용량 제한/형식 외형 프로브/해시 → TX1 새 revision + PENDING 예약 → SQL 트랜잭션 밖에서 create-only write → 실제 read-back과 크기/SHA 비교 → TX2 재인가와 READY/FAILED 전이 → READY만 private download 시 크기/SHA 재검사**. TX1과 TX2 간 실패/Crash/권한철회는 PENDING·미완료 파일을 남길 수 있다. 이는 의도된 현재 한계이며, 자동 GC·백그라운드 복구가 있다고 표현하지 않는다.

3C 프로브는 PDF 매직/종료 토큰 및 DXF의 제한된 구조 검사다. **파일이 유효한 산업용 패턴, 그레이딩 가능한 형상 또는 악성 파일 무해성을 인증하지 않는다**. MIME/파일명은 증거가 아니다. 검증된 SHA도 서명, 작성자 진정성, 계약 동의를 증명하지 않는다.

## 2. 장기 사업 아키텍처: 방향 채택, 현재 구현과 구분

`DISCOVER → DEVELOP → SOURCE → TRANSACT → PRODUCE → LEARN`의 도메인 흐름과 `Search → Workflow(System of Record) → Transaction → Intelligence` 수익화 가설은 유지한다. 공급처 탐색은 획득 채널, 반복적인 디자인·스펙 이력 관리는 SaaS 가치, 견적·분쟁 증빙·결제보호·QC는 거래 지속 유인, 적법한 통계는 장기 차별화라는 **사업 가설**이다. 이는 자동 수익·락인·우회 거래 방지를 보장하지 않는다.

- 글로벌 공급 데이터는 공급사·시설·소재 및 근거/상태를 별개 사실로 유지한다. 반대편 고객의 자체 공급사 주소록은 공유 기본값이 아니다.
- 고객의 패턴·요척·정확한 발주량·개별 네고 단가는 비공개 영업비밀이다. 동의 없는 교차 테넌트 학습·추천·학습용 원천 추출은 금지한다.
- 기존 마스터 `ManufacturingSpecificationPackage`, 계약/견적 리비전 불변성, 외부 라이선스 결제보호 사업자 사용(ADR 013·014)의 방향을 존중한다. 별도의 현재 계약·결제 도메인을 만들지 않는다.
- 초기 SaaS 유료화/거래수수료, 데이터 상품의 계약·실제 수요·비용구조는 검증 전 가설이다. 법률적 집행력·영업비밀 이용권·보안 인증까지 아키텍처만으로 확정했다고 주장하지 않는다.

## 3. 미래 참조 모델: 불변 입력 핀, 단방향 의존, 역사적 재현성

### 현재 승인·구현 범위

- `MeasurementRevision`은 V18의 완전한 불변 계측 스냅샷이다.
- `PatternRevision`은 V19의 불변 메타데이터 Revision이다. optional `measurement_revision_id`는 같은 Style 관계를 DB 복합 FK로 검사한다.
- `PatternArtifact`는 V20의 새 revision에 결합되는 서버 고유 `storage_object_id`, 크기/해시/상태 메타데이터다. 저장 객체는 테넌트별 create-only이며 일반 Development Reference로 치환하지 않는다.
- 기존 3B/3C의 `PatternRevision` 번호는 각 Pattern 안에서 1,2,3... **선형 이력**이다. 장래 **도메인 간 단방향 참조 관계를 DAG처럼 설계한다**는 말은 기존 Revision 역사에 fork/merge를 도입하자는 뜻이 아니다.

### 이후 별도 승인 영역

- **Grading(계획 3D)**: 기존 `GradeRuleSet / GradeRuleSetRevision` 비전과 결정적 계산, 패턴·계측 소유권, 참조 시점의 규격을 별도 계약. 특정 `pattern_revision_id`와 `measurement_revision_id`를 항상 이중 필수 FK로 고정한다는 새 약속은 현 단계에 하지 않는다. Phase 3 계획상 3D V21은 *예정 번호*이며 이번 구현 상한 V20 밖이다.
- **QA(계획 3E)**: exact PatternRevision에 대한 검토/판정 증빙. 사람이 확인한 상태와 실제 생산검증 상태를 혼동하지 않는다. V22는 필요 시에만 계획.
- **Pattern Release(계획 3F)**: 해시 검증 가능한 정확한 Revision/수신자/권한/철회 모델. V23은 필요 시에만 계획. **현재 V20의 SHA가 곧 Release baseline_hash인 것은 아니다.**
- **Yield / Marker / BOM / Costing(도메인 소유권 미확정)**: 별도 불변 계산/입력 스냅샷으로 향후 정의. 동일 Pattern에서도 절단 가능 폭, 수축률, 결방향, 마커 배열, 사이즈 믹스에 따라 요척이 달라진다. 단순 업로드만으로 생산 확정 요척을 계산했다고 주장하지 않는다.
- **Contract baseline(Phase 6+)**: 승인된 규격/포함 아티팩트의 해시, 정규화된 Manifest 형식·버전, 당시 사용한 계약/가격/QC/승인 상태, 서명·수락증거·보존 정책을 모두 명확히 정의할 때 구현한다. UUID 문자열을 이어 붙인 해시만으로 충분하지 않다.

특히 V15 `style_material_selection`은 제거 가능한 private relation이다. 미래 Yield/BOM이 이 ID 하나만 바라보면 **과거 원단 규격·실제 거래단가를 복원할 수 없다**. 계산 시점에 적용된 불변 material spec / width / unit / price basis / currency / size mix / assumptions / 출처·검증 수준을 별도 freeze해야 한다. 공개 MaterialPrice는 네고된 Quote가 아니다. 이런 결과 스키마는 **지금 추가하지 않는다**.

## 4. BYOS(자체 거래처) — 비즈니스 요구는 수용, '단일 Facility 컬럼 추가'는 미채택

브랜드가 이미 사용하는 공장과 바로 DEVELOP→SOURCE를 진행하는 BYOS는 Cold Start 대응에 유효하다. 그러나 물리 스키마 선택은 유보한다.

**위험:** 기존 `facility`는 글로벌 `supplier_profile`에 필수 종속되고, `style_facility_candidate` V16은 글로벌 `facility_id` 필수 FK다. 여기에 `visibility_scope=GLOBAL/TENANT_PRIVATE`, `owner_org_id`를 단순 추가하면 전역 검색·상세·플랫폼 관리·소스 인용·검증·식별자 매칭 로직 전체가 private 레코드를 실수로 노출할 수 있다. 본래 buyer-owned private 연락처에 글로벌 supplier ownership을 강제하는 모순도 생긴다. 테이블 하나가 FK를 줄인다는 이유만으로 더 안전하거나 변경 비용이 적다고 볼 수 없다.

**별도 BYOS ADR에서 비교할 옵션**:

A. 글로벌/테넌트 private 엔티티 별도 보존 + 타입 안전한 Sourcing Counterparty 참조/해결 계약: 격리에 유리하지만 후보/거래 참조 복잡성이 있다.

B. 권한이 강제된 통합 party identity/registry + scope별 상세 데이터: 외부 논리 ID를 통일할 수 있지만 DB FK/분리 정책·조회 표면·중복 판정이 복잡하다.

C. 현재 global `facility` 자체의 scope 확장: 기존 전체 조회/API/관리/출처 트랜잭션을 검증하고 **누락 시 교차 테넌트 유출이 불가능함**을 DB와 서비스 레벨에서 증명한 뒤에만 검토한다.

결정 기준: DB 수준 same-tenant 무결성, 기본 비공개·누출 방지, global 공급사 Claim & Merge 시 동의/감사/잘못된 매칭의 복구, 글로벌 기존 API 호환, future RFQ reference 안정성, 마이그레이션 비용. **승격은 자동 Merge가 아니라 검증된 증거 및 각 정보의 공개 권한 승인**이다. V16은 지금 손대지 않는다.

## 5. 외부 공급자 Magic Link / Guest RFQ — 개념만 유지

미래 외부 공장에 SaaS 로그인/정식 조직 가입을 강제하지 않는 목표는 유효하다. 그러나 현 인증은 OIDC issuer+subject 및 Organization membership 기반이므로 `OrgMemberPrincipal` 이름을 현재 실재 클래스처럼 서술하거나 지금 인증 주체를 재설계해서는 안 된다.

향후 별도 Guest 권한 모델은 **특정 수신인·특정 Release 또는 RFQ·특정 명령·만료·철회·열람/제출 로그**에 한정한다. 고엔트로피 1회성 초대 토큰을 검증 후 짧은 수명의 좁은 Guest Session으로 교환하는 방식이 가능하며, 이메일/메신저의 전달·유출은 본인 확인/추가 인증 수준 결정이 필요하다. 직접 object URL 제공/조직 멤버십 위장/관리 권한 확대 금지. 워터마크는 유출 억제이지 완전한 복사 방지가 아니다.

RFQ의 견적 폼, PDF/XLSX 파서, AI 자동 구조화, 외부 발송 채널과 발신자 동의, 제출 이력은 **Phase 5 이후 별도 계약**이다. No parser worker, no queue, no Guest grants in V20.

## 6. Market Intelligence·비식별·과금 — '인터페이스 방향'과 '테이블 생성'의 명확한 분리

- **개념적 데이터 경계**: `Tenant-Private Data` / 계약·목적상 추출 가능한 `Eligible Market Signal` / 공개 심사된 `Published Aggregate`. 정보 제거·버킷팅만으로 익명성이 보장되는 것은 아니며, 적은 표본·특정 공장·반복 질의·우세한 단일 고객으로 재식별될 수 있다.
- 나중에 실제 데이터 상품화하려면 데이터 사용권·동의/계약 근거·목적/보유기간·최소 조직 수·민감 소규모 집계 억제·기여 상한·감사/삭제정책 등을 별도 정책과 파이프라인으로 심사한다. ***지금 telemetry_consent, usage_ledger, signal_candidate 등 테이블을 만들지 않는다.***
- 구독/사용량/AI 크레딧은 실제 Pricing, 과금 주체, 시간창, 예약/환불/비동기 작업 성공기준과 과금정책이 결정된 후 엔타이틀먼트/원장을 설계한다. 미정 가격정책에 맞춰 V21 사용량 원장을 선행 구축하거나 모든 API에 하드코딩 `isPro` 조건을 추가하는 것은 양쪽 모두 금지.
- 현재 3C의 DB 모델·업로드 API에 요금제별 quota 슬롯, analytics event, 외부 메신저, 비동기 파서 스케줄러를 주입하지 않는다.

## 7. 현 단계 3C 기술 정책 (V20 ceiling)

**허용/존재하는 범위**
- 새 불변 PatternRevision 생성과 artifact_expected, per-revision UNIQUE PatternArtifact 예약
- 정확한 선언 포맷/크기 제한(최대 10MiB), 제한적 PDF/DXF envelope probe, SHA-256 계산
- Tenant-private server UUID storage create-only, non-XA TX1/IO/TX2, authorized read-back 및 download 재검증
- pending/failed durable metadata 보존, 권한·아카이브/충돌·동시성 안전성, API/OpenAPI/프런트 검증
- 현재 CI 성공 + 독립 기능·보안·마이그레이션 리뷰(아직 승인 아님)

**현 단계 금지 범위**
- V21 이상 신규 Flyway migration, V18/V19/V20 재명명·역사 수정, 기존 정합성 완화
- Marker/Yield/BOM/Costing FK/JSON 슬롯을 V20에 선삽입
- Grading, QA, Pattern Release, Guest, RFQ, Contract, BYOS, Billing, Analytics, AI·Geometry parser
- Queue/worker/cron, 백그라운드 PENDING reconciliation/GC, 크로스 테넌트 CAS·객체 dedup
- R2/S3 등 특정 스토리지 벤더의 코드 하드 고정, storage ID·SHA 원문 노출, 서명 없는 공개 파일 URL
- 외부 검증 없이 'DONE', '정확한 DXF 파싱 완료', '법적 증빙 보장' 단정

**판정 기준:** 정확한 `7381303` 코드·정확한 CI SHA, V19 populated→V20 migration/트리거 보존, UUID/tenant negative testing, 10MiB 경계, PENDING/READY/FAILED 경계, TX1/IO/TX2 crash/window, read-back SHA mismatch, READY download 무결성, 숨겨진 ID·해시·credential 비노출, stale-head/아카이브/철회·다운로드 정합성. 성공 CI는 검수 증거이지 독립 승인 대체물이 아니다.

## 8. 앞으로의 의사결정 로드맵 — 다른 시점의 승인 분리

1. **현재:** Phase 3C independent review 및 필요 시 별도 승인된 최소 결함 수정; V20에서 멈춤.
2. **다음 승인 후보:** Geometry/Parser 아키텍처를 실물 CAD fixture·보안·성능 증거로 결정. 아직 실제 구현하거나 worker/queue를 도입하지 않는다.
3. **Phase 3D/3E/3F:** Grading → QA → exact-revision secure Release, 각각 독립 스펙·테스트·DDL 승인. 3D의 V21은 원래 계획에 따른 후보이지 현재 3C 이행 허가가 아니다.
4. **추가 별도 비즈니스 ADR:** BYOS 저장 구조, Costing/BOM/Yield 소유권, Market Signal 권한, Guest RFQ, Pricing/Entitlement. 제품의 실사용·유료화 검증 결과와 결합해 우선순위를 재조정한다.
5. **Phase 5 이후:** RFQ→수락된 Quote→계약 Manifest→외부 결제보호/QC→합법적인 통계·재발주. Search/Mail Bot 역시 별도 데이터 출처 권한·배포·운영 스펙으로 병행 여부 결정. '무조건 모든 Phase 이후' 같은 고정 개발 순서는 약속하지 않는다.

## 9. 기획자에게 요청할 확인사항

- 장기 4대 수익 모델은 사업 가설로 유지하고, 각 단계의 **구매자 가치·유료 전환 트리거·영업상 리스크**를 문서화.
- 현재 3C가 **Artifact storage integrity** 단계이지 geometry correctness, grading, costing, contract enforcement 단계가 아니라는 구분을 IR/사업계획서에 명시.
- BYOS는 사용자 경험상 하나의 공급자 선택 경험을 제공하되 DB 단일 테이블 채택 여부는 기술 실증 후 결정.
- 향후 Costing은 Source Selection의 현재/삭제가능 관계만 참조하지 않고 실제 입력 스냅샷을 남긴다는 요구를 유지.
- 계약/결제보호/시장 통계는 법률·정보보호·공급사 권한·라이선스 요건과 별도 검토.
- **별도 구현 지시 전에는 V20 이후 스키마/도메인/워커를 생성하지 않는다.**

---

### 최종 한 문장

**“SOURCE OS는 Search→Workflow→Transaction→Data라는 사업 구조를 지향하되, 현재 개발은 검증 가능한 Pattern Artifact 무결성 계약(V20)에서 멈추고, BYOS·Costing·Release·Guest·과금·통계는 근거와 승인에 따라 독립적으로 확장한다.”**

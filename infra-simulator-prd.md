# Rack Mesh — 장비 레벨 인프라 시뮬레이터 PRD

작성일: 2026-09-02
개정: v0.5 (제품명을 Rack Mesh로 변경)
이전 개정: v0.4 (MVP 범위, 계산 의미, 데이터 선택 규칙, 인수 기준 구체화)
상태: 초안 (Draft)
작성 배경: breakscale(github.com/xevrion/breakscale) 검토 후 파생

---

## 1. 한 줄 정의

네트워크 장비와 서버 장비를 캔버스에 배치하고 트래픽을 흘려서, **어느 장비의 어느 한계에 먼저 부딪히는지**를 계산으로 보여주는 인프라 설계 도구.

## 2. 배경

breakscale은 애플리케이션 레이어의 이산사건 시뮬레이터다. 컴포넌트(캐시, 큐, DB)를 논리적으로 배치하고 부하를 올려 큐잉 동역학을 관찰한다. 잘 만들어졌고 목적도 분명하지만, 컴포넌트의 자원이 사실상 하나(`capacity × instances` 슬롯)라는 한계가 있다.

실제 인프라 설계에서 사람이 매번 손으로 하는 계산은 다르다. 스위치는 대역폭과 별개로 포워딩 레이트(pps)와 버퍼 한계가 있고, 방화벽은 대역폭 사용률 10%에서 신규 세션/초(CPS)에 먼저 걸린다. 랙은 전력 예산 때문에 사이징한 서버가 안 들어가기도 한다. **한 장비가 서로 독립인 한계를 대여섯 개 갖고 있고, 설계의 기술은 어느 축에 먼저 닿는지 아는 것이다.**

이 계산은 장비 클래스와 축마다 서로 다른 도구, 스프레드시트, 경험에 흩어져 있다. 토폴로지 변경과 장애 시나리오를 같은 모델에서 다시 계산하기 어렵다.

## 3. 목표

- 토폴로지와 트래픽 프로파일을 입력하면 장비별 다차원 사용률을 즉시 계산한다.
- 병목이 되는 **축**(bps / pps / CPS / 세션 / 포트 / 전력 / U)을 명시적으로 지목한다.
- 장비나 링크를 제거했을 때 남은 경로가 부하를 받아내는지 재계산으로 검증한다.
- 모든 용량값에 출처와 측정 조건을 붙이고, 모든 파생값에 계산 근거를 남긴다.

### MVP 범위

Phase 1은 **단일 데이터센터 내부의 네트워크 경로와 랙 물리 제약**만 다룬다. Switch, Router, Firewall, Load Balancer, 링크, 서버 NIC, Rack, PDU가 대상이다. 서버 CPU·메모리·NUMA와 Storage IOPS·지연은 워크로드 모델이 별도로 필요하므로 Phase 1에서 계산하지 않는다.

MVP의 대표 작업은 다음과 같다.

- 현재 설계에서 가장 먼저 포화되는 장비와 축을 찾는다.
- 장비 또는 링크 한 개가 실패한 뒤 과부하와 단절을 찾는다.
- 증설 전후 시나리오의 최소 headroom을 비교한다.

### 비목표

- 패킷 단위 시뮬레이션. ns-3, OMNeT++의 영역이며 브라우저에서 실시간 인터랙션과 양립하지 않는다.
- 실제 장비 설정 생성(Ansible, config 템플릿). 설계 검토 도구지 프로비저닝 도구가 아니다.
- 애플리케이션 아키텍처 교육. breakscale이 이미 그 자리에 있다.
- **벤더 간 성능 비교나 순위 산출.** 8절 참조. 이건 범위 밖일 뿐 아니라 명시적으로 금지한다.
- 서버 애플리케이션의 CPU·메모리 요구량 추정과 Storage IOPS 추정. Phase 1 트래픽 입력만으로 신뢰성 있게 유도할 수 없다.
- STP, BGP 수렴, 방화벽 정책 평가와 같은 제어 평면 동작 재현.

## 4. 대상 사용자

1차는 인프라·네트워크 엔지니어, SRE, 데이터센터 설계 담당자다. 랙 설계 리뷰, 증설 검토, 장애 사후 분석에서 쓴다.

2차는 학습자다. 인프라를 배우는 사람이 "10G 링크인데 왜 죽었나"를 이해하는 데 쓴다. 다만 1차 사용자가 실무에서 쓸 수 있는 정확도가 먼저고, 교육 가치는 거기서 파생된다.

1차 사용자는 기존 설계 파일과 장비 데이터를 불러오고, 트래픽과 장애 조건을 바꾼 뒤, 계산 근거가 포함된 결과를 설계 리뷰에 첨부할 수 있어야 한다. 2차 사용자는 프리셋만으로 같은 흐름을 수행할 수 있어야 한다.

## 5. 핵심 개념 모델

### 5.1 장비(Device)

장비는 여러 개의 독립적인 한계를 가진 객체다. 클래스별로 의미 있는 한계 축이 다르다.

| 클래스 | Phase 1 축 | 이후 축 |
|---|---|---|
| Switch (L2/L3) | 포워딩 bps, 포워딩 pps, 포트와 업링크 용량 | 버퍼 점유와 큐잉 지연 |
| Router | 포워딩 bps, 포워딩 pps, 포트 용량 | FIB 크기와 slow-path 부하 |
| Firewall | 처리량 bps, CPS, 동시 세션 | 기능별 페널티 곡선 |
| Load Balancer | CPS, 동시 커넥션, TLS full/resumed handshake TPS, L7 처리량 | 큐잉과 재시도 부하 |
| Server | NIC bps, NIC pps, 전력, U | 코어 수, NUMA 노드, 메모리, PCIe 대역폭 |
| Storage | 포트, 전력, U | IOPS, 처리량, 지연 곡선 |
| Rack / PDU | 전력 예산, U 공간 | 냉방 용량과 전원 경로 장애 |

### 5.2 다차원 제약

각 장비에 대해 축별 사용률 벡터를 계산한다.

```
u[axis] = load[axis] / limit[axis]
binding_axis = argmax(u)
headroom = 1 - max(u)
```

UI는 `max(u)` 하나만 보여주지 않는다. 어느 축이 병목인지가 이 도구의 핵심 산출물이다. "이 방화벽 87%"가 아니라 "이 방화벽 CPS 87%, 대역폭 11%".

`headroom`은 한계값과 부하가 모두 알려진 축에만 계산한다. `headroom < 0`은 초과 비율을 보존하며 과부하를 뜻한다. 한계값이 없거나 현재 조건에 맞는 값이 없으면 해당 축은 `unknown`이다. `unknown` 축을 제외하고 장비를 안전하다고 판정하지 않는다.

결과 상태는 한 enum에 섞지 않는다. 입력·계산은 `valid | invalid`, demand 전달은 `delivered | unreachable`, 용량은 `healthy | warning | overloaded | unknown`으로 각각 기록한다. 한 장비에 `overloaded` 축과 `unknown` 축이 함께 있을 수 있다. `warning` 임계값은 기본 80%이며 사용자가 바꿀 수 있다. 이는 장비의 물리 한계가 아니라 운영 여유 기준이다.

`headroom`은 계산값을 뜻한다. 제품명 Rack Mesh와 구분하기 위해 항상 소문자 코드 표기로 쓴다.

### 5.3 트래픽 프로파일

RPS, bps, pps, CPS는 서로 자동 변환할 수 있는 같은 단위가 아니다. Phase 1 엔진은 아래 **부하 벡터**를 표준 입력으로 쓴다. 각 차원은 명시값인지 파생값인지 기록한다. 여러 명시값과 패킷 분포가 서로 모순되면 `invalid`로 처리한다. 프리셋은 사용하기 쉬운 입력에서 이 벡터를 만들고, 사용한 공식과 가정을 함께 저장한다. 사용자가 직접 값을 덮어쓸 수도 있다.

```yaml
traffic_profile:
  schema_version: 1
  name: string
  load:
    wire_bits_per_sec: { value: number, origin: explicit | derived }
    packets_per_sec: { value: number, origin: explicit | derived }
    new_sessions_per_sec: { value: number, origin: explicit | derived }
    concurrent_sessions: { value: number, origin: explicit | derived }
    tls_full_handshakes_per_sec: { value: number, origin: explicit | derived }
    tls_resumed_handshakes_per_sec: { value: number, origin: explicit | derived }
  packet_mix:
    size_scope: ethernet_frame_without_preamble_ifg
    entries:
      - frame_bytes: 64
        ratio: 0.4
      - frame_bytes: 1518
        ratio: 0.6
  protocol:
    transport: tcp | udp | mixed
    tls_cipher: rsa2048 | ecdsa_p256 | mixed | none
  derivation:
    preset_id: string | null
    assumptions: [string]
```

`packet_mix.entries[].ratio`의 합은 1이어야 한다. `wire_bits_per_sec`는 preamble과 IFG를 포함한 링크 점유량이다. 패킷 크기의 원래 표기 범위는 보존하고, 변환 규칙을 결과에 표시한다. 64-byte Ethernet frame은 Phase 1에서 8-byte preamble과 12-byte IFG를 더해 84 bytes의 wire 점유량으로 계산한다.

파생값은 필요한 입력이 모두 있을 때만 계산한다. 예를 들어 정상 상태에서 신규 세션 비율을 직접 알 수 있으면 `concurrent_sessions = new_sessions_per_sec × duration_sec_mean`을 적용한다. 연결 재사용률만으로 CPS를 추정하지 않는다. TLS full handshake와 resumed handshake는 장비 비용이 다르므로 분리한다.

사용자에게 이 값을 전부 입력받으면 도구가 죽는다. **워크로드 프리셋에서 파생시킨다.** 프리셋 자체가 이 도구의 교육 콘텐츠다.

초기 프리셋 후보: 웹 API(keep-alive 높음), gRPC 마이크로서비스(East-West 지배), 블록체인 P2P 가십(소패킷 다수, 풀메시에 가까운 East-West), 백업·복제 벌크 전송(대패킷, 소수 플로우), VDI, 스트리밍 배포.

### 5.4 토폴로지와 트래픽 매트릭스

토폴로지는 노드(장비)와 링크(포트-포트 연결)의 그래프다. 링크는 방향별 속도, 매체 지연, 관리 상태, LAG 멤버십을 갖는다. 트래픽 매트릭스의 각 demand는 출발 endpoint, 도착 endpoint, 트래픽 프로파일, 배율을 참조한다. 프리셋의 East-West와 North-South 비율은 매트릭스를 만드는 입력일 뿐이며, 생성된 매트릭스가 계산의 기준이다.

Phase 1은 사용자가 지정한 경로를 우선한다. 지정 경로가 없으면 최소 비용 경로를 계산하고, 같은 비용의 경로에는 demand를 균등 분배한다. 링크 비용과 ECMP 분배 결과를 저장한다. LAG도 멤버 링크에 균등 분배한다. 해시 쏠림과 flow 단위 불균형은 Phase 2에서 다룬다.

장애 뒤 경로가 없어진 demand는 삭제하지 않는다. 전체 부하와 함께 `unreachable`로 보고한다. 링크 부하는 ingress와 egress를 분리하며, full-duplex 링크의 용량도 방향별로 계산한다.

### 5.5 계산 계약

- 내부 단위는 SI base unit을 사용한다. 화면에서만 Gbps, Mpps, kW 등으로 변환한다.
- 합산 전에는 용량값의 방향, 패킷 크기 범위, 기능 상태와 단위를 맞춘다.
- 현재 조건과 일치하는 한계값이 없으면 보간하지 않고 `unknown`을 반환한다.
- 표시 반올림은 판정에 영향을 주지 않는다.
- 프로젝트는 선택한 장비 프로필의 revision과 content digest를 고정한다. 외부 라이브러리 변경은 기존 프로젝트의 결과를 바꾸지 않는다.
- 같은 입력, 데이터 revision, 엔진 버전은 같은 결과를 만든다.

## 6. 기능 요구사항

### Phase 1 — 정적 제약 솔버 (MVP)

시간 개념이 없다. 정상 상태 계산만 한다. 이 단계만으로 실무에서 쓸 수 있어야 한다.

| ID | 요구사항 | 인수 기준 |
|---|---|---|
| P1-1 | 캔버스에 장비를 배치하고 포트 간 링크로 연결한다 | 존재하지 않는 포트, 속도가 맞지 않는 포트, 중복 연결을 저장 전에 표시한다 |
| P1-2 | 장비 라이브러리에서 장비를 선택하거나 사용자 정의 장비를 만든다 | 사용자 정의 값에도 단위, 조건, 출처 또는 `estimate` 표시가 필요하다 |
| P1-3 | 트래픽 프리셋과 규모 배율을 제공한다 | 배율 변경 뒤 부하 벡터와 파생 근거를 확인할 수 있다 |
| P1-4 | 출발지-목적지 트래픽 매트릭스를 정의한다 | 각 demand의 경로, 분배 비율, 전달 여부를 확인할 수 있다 |
| P1-5 | 장비별·링크별 축 사용률과 binding axis를 계산한다 | 알려진 모든 축의 load, limit, utilization, headroom을 표시한다 |
| P1-6 | 계산 유효성, demand 전달, 축별 용량 상태를 구분한다 | 동시에 발생한 상태를 숨기지 않고 색상 외 텍스트와 아이콘으로도 구분한다 |
| P1-7 | 장비나 링크를 비활성화하고 즉시 재계산한다 | 단절된 demand와 재경로된 demand를 별도로 표시한다 |
| P1-8 | 랙 단위 전력과 U 공간을 집계한다 | nameplate, typical, measured 전력값을 섞지 않고 사용한 기준을 표시한다 |
| P1-9 | 모든 한계값에 출처와 측정 조건을 표시한다 | 결과에서 원본 출처와 적용된 데이터 레코드까지 추적할 수 있다 |
| P1-10 | 프로젝트를 versioned JSON으로 저장하고 불러온다 | 장비 프로필 revision과 digest를 포함한다. 왕복 후 의미가 같고, 지원하지 않는 미래 버전은 명시적으로 거부한다 |
| P1-11 | NetBox devicetype-library 물리 정의를 임포트한다 | 원본 저장소와 commit을 provenance로 기록하고, 변환 오류를 항목별로 보고한다 |
| P1-12 | 성능 한계값이 없는 장비도 물리 축만 계산한다 | 알 수 없는 성능 축은 `unknown`이며 0% 또는 안전으로 표시되지 않는다 |
| P1-13 | 사용자가 장비 한계값을 시나리오 안에서 덮어쓴다 | 원본값과 override를 모두 보존하고 결과에 사용값을 표시한다 |
| P1-14 | 기준 시나리오와 장애 시나리오를 비교한다 | 최소 headroom, binding axis, 단절 demand의 변화를 보여준다 |

P1-12가 중요하다. 물리 데이터는 수천 종을 바로 확보할 수 있지만 성능 데이터는 수십 종에서 시작한다. 성능값이 비어 있다고 장비를 쓸 수 없으면 도구가 텅 빈 채로 출시된다.

### Phase 2 — 시간축과 동역학

Phase 1 없이 Phase 2만 만들면 라벨만 바꾼 breakscale이 된다.

| ID | 요구사항 |
|---|---|
| P2-1 | 시간에 따른 트래픽 변화(일일 패턴, 스파이크)를 입력한다 |
| P2-2 | 버퍼 점유와 큐잉 지연을 시간축으로 계산한다 |
| P2-3 | 링크 포화 시 손실을 모델링하고 재전송 부하를 반영한다 |
| P2-4 | ECMP 해시 쏠림을 확률적으로 모델링한다 (링크 하나만 포화되는 상황) |
| P2-5 | 장애 발생·복구 이벤트를 시간축에 배치하고 페일오버 구간을 관찰한다 |
| P2-6 | flow 단위 ECMP와 LAG 분배 불균형을 모델링한다 |

### Phase 3 — 후보 (범위 미확정)

- 서버 CPU·메모리·NUMA와 Storage IOPS·지연 모델
- 비용 축: 장비 CapEx와 전력 OpEx. 클라우드 환산 비교는 별도 검토
- 설계 제안: 병목 축을 해소하는 최소 변경 제시
- 실측 데이터 임포트: SNMP/telemetry 카운터를 넣어 모델을 캘리브레이션

## 7. 장비 라이브러리: 2층 데이터 모델

장비 정의를 **물리층**과 **성능층**으로 나눈다. 두 층은 확보 난이도와 신뢰도가 완전히 다르므로 같은 파일에 섞지 않는다.

### 7.1 물리층 — 기존 자산을 가져온다

`netbox-community/devicetype-library`는 실제 제조사와 모델을 담은 커뮤니티 장비 정의 모음이다. 저장소가 선언한 라이선스와 필요한 필드를 도입 시점의 고정 commit에서 검증한 뒤 가져온다.

| NetBox 필드 | 본 도구에서의 용도 |
|---|---|
| `manufacturer`, `model`, `part_number` | 장비 식별 |
| `u_height`, `is_full_depth` | 랙 U 소비 계산 |
| `power-ports[].maximum_draw` | 장비의 nameplate 전력 부하 입력 |
| `interfaces[].type` | 포트 속도와 개수, 링크 연결 가능 여부 |
| `module-bays`, `device-bays` | 모듈형 섀시와 블레이드 모델링 |
| `rack-types` (별도 디렉터리) | 랙 컨테이너 정의 |

랙이나 PDU의 전력 예산은 장비의 `maximum_draw` 합과 다른 값이다. 별도 rack/PDU 프로필에서 입력한다. 임포터는 실제 upstream schema와 fixture로 위 필드 매핑을 검증한다. 출처 저장소, commit, 변환기 버전을 기록한다.

### 7.2 성능층 — 여기가 이 프로젝트의 기여 지점

선정한 물리층 데이터에는 포워딩 pps, 처리량 bps, 동시 세션, CPS, TLS TPS 같은 조건부 성능값이 없다. 초기에는 이 성능층을 직접 만든다. 대체 데이터셋 조사는 별도 과제로 남긴다.

```yaml
performance_profile:
  schema_version: 1
  profile_id: string
  revision: string
  device_ref:                      # 물리층 정의를 참조
    manufacturer: string
    model: string
  class: switch | router | firewall | lb | server | storage
  limits:
    - axis: forwarding_bps | forwarding_pps | buffer_bytes | concurrent_sessions
            | new_sessions_per_sec | tls_full_handshakes_per_sec
            | tls_resumed_handshakes_per_sec | iops | nic_bps | nic_pps
      value: number
      unit: bit_per_sec | packet_per_sec | byte | session | session_per_sec
            | handshake_per_sec | operation_per_sec
      scope: ingress | egress | bidirectional_aggregate | system | per_port
      conditions:                   # 필수. 조건 없는 값은 등록 거부
        packet_size_bytes: number | null
        packet_size_scope: string | null
        traffic_rate_scope: wire | ethernet_frame | ip_packet | payload | unknown
        features_enabled: [string]  # 예: ["ips", "logging", "nat"]
        features_disabled: [string]
        cipher: string | null
        queue_depth: number | null
        firmware_version: string | null
        test_method: string | null
      source:
        type: datasheet | third_party_test | user_measured | estimate
        url: string | null
        retrieved_at: date
        locator: string | null      # 페이지, 표, 테스트 케이스 등
        note: string
  latency:
    mode: cut_through | store_and_forward
    base_ns: number
```

**측정 조건 객체는 필수다.** 각 조건은 구체적인 값, `unknown`, `not_applicable` 중 하나로 기록한다. `null`은 스키마에서 허용하더라도 그 의미를 필드별로 정의한다. `unknown` 조건이 있는 값은 사용자가 명시적으로 선택한 경우에만 계산에 쓴다. 데이터시트 숫자는 특정 조건에서 측정된다. 조건 없이 숫자만 넣으면 적용 가능성을 판단할 수 없다.

UI 표기 원칙: `20 Gbps` (X) → `20 Gbps @ 1518B, IPS off` (O)

**값 선택 규칙.** 출처 종류만으로 단일 신뢰도 순위를 만들지 않는다. 먼저 모델, firmware, 기능, 패킷 크기와 범위가 현재 시나리오에 맞는지 평가한다. 조건이 같은 후보끼리는 해당 환경의 반복 실측값, 독립 테스트, 데이터시트, 추정값 순으로 기본 표시할 수 있다. 사용자가 선택한 값과 선택 이유를 프로젝트에 고정한다. 조건이 맞지 않으면 가장 가까운 값을 자동 적용하지 않는다.

### 7.3 저장소 분리

```
rack-mesh/             엔진 + UI. 벤더 데이터 0건
rack-mesh-devices/     성능층 정의. 커뮤니티 기여
  (물리층은 devicetype-library를 서브모듈 또는 빌드 시 임포트)
```

엔진 코드에 벤더 데이터를 두지 않는다. 이 분리는 데이터 revision 고정, 라이선스 관리, 데이터 기여 검토를 독립시킨다.

## 8. 벤더 데이터 취급 원칙

장비를 실명으로 표기한다. 익명 클래스("48포트 25G 리프급")는 실무 설득력이 없어 채택하지 않는다. 대신 아래 원칙을 지킨다.

제조사명과 모델명은 제품 식별에 필요한 범위에서 쓴다. 스펙값을 수집할 때는 각 출처의 이용 조건과 재배포 가능 범위를 확인한다. 법적 평가는 관할과 수집 방식에 따라 달라질 수 있으므로 이 문서에서 적법성을 단정하지 않는다.

**하지 않는 것.**

- 데이터시트의 문장, 표 구성, 도면, 이미지를 복제하지 않는다. 숫자만 추출해 자체 스키마로 재구성한다.
- 벤더 로고와 브랜드 이미지를 쓰지 않는다.
- 제휴, 인증, 승인을 암시하는 표현을 쓰지 않는다.
- 벤더 사이트를 자동 크롤링하지 않는다. 항목 단위로 수집하고, 원문 대신 값과 provenance만 저장한다. 대량 수집이 필요하면 이용 조건과 데이터베이스 권리를 별도로 검토한다.
- **벤더 간 순위나 우열 비교 화면을 만들지 않는다.** 벤더가 실제로 반응하는 지점은 모델명이 아니라 "A사가 B사보다 먼저 죽는다"는 출력이다. 사용자가 자기 토폴로지 안에서 두 장비를 바꿔가며 비교하는 건 자연스럽지만, 도구가 정규화된 벤더 랭킹을 산출하지는 않는다.

**고지.** 계산 결과 화면과 README에 데이터의 출처, 조건, 선택한 override, 엔진 버전을 표시한다. 실제 도입 전에는 공식 자료와 해당 환경의 실측값으로 다시 검증하도록 안내한다.

이 문서는 법률 자문이 아니다. 공개 전 변호사 검토를 권한다.

## 9. 검증 전략

이 도구의 신뢰도는 계산의 정확성, 입력 데이터의 적용 가능성, 결과의 추적 가능성에서 나온다.

**산술과 불변조건 테스트.** 단위 변환, 정상 상태의 Little's law, 방향별 링크 부하 보존, ECMP 분배 합, 사용률의 유한성, 표시 반올림과 판정의 분리를 검증한다. 유효한 부하와 한계값은 음수가 될 수 없다. `headroom`은 과부하에서 음수가 될 수 있다.

**장비 한계는 계산하지 않고 인용한다.** 모델링 대상이 아니라 입력 상수다. 출처와 조건을 붙여 검증 가능하게 둔다.

**golden scenario 재현.** 10 Gbps 링크에 64-byte Ethernet frame만 입력하면 preamble과 IFG를 포함해 약 14.88 Mpps가 나온다. 2:1 오버섭스크립션, ECMP 2경로, 단일 링크 장애, 무경로 demand, full-duplex 비대칭 부하도 고정 fixture로 검증한다.

**데이터 계약 테스트.** 단위, scope, 조건, source, locator, schema version을 검증한다. 조건이 맞지 않는 용량값이 자동 선택되지 않는지 확인한다.

**실측 대조.** 조건이 일치하는 장비 카운터와 계산 결과를 축별로 비교한다. 오차는 축별 MAPE와 최대 오차로 기록하며, 조건이 다른 표본은 별도 집단으로 둔다.

## 10. 비기능 요구사항

| 항목 | 목표 |
|---|---|
| 재계산 지연 | 노드 200개, 링크 500개, demand 1,000개에서 warm-up 후 p95 100ms 이내. 기준 브라우저와 하드웨어는 Alpha 전에 고정 |
| 실행 환경 | 브라우저 단독. 서버 의존성 없음 |
| 저장 | 로컬 저장 + versioned JSON 내보내기. 자동 저장 실패를 사용자에게 표시 |
| 결정성 | 같은 입력은 항상 같은 출력. Phase 2 확률 모델은 시드 고정 |
| 장비 라이브러리 | 코드가 아닌 데이터 파일. 별도 저장소 (7.3) |
| 데이터 갱신 | 물리층은 업스트림 동기화로. 성능층은 `retrieved_at` 기준 노후 항목 표시 |
| 개인정보 | 기본 실행은 외부 요청을 보내지 않는다. 프로젝트 파일과 사용자 실측값은 로컬에 둔다 |
| 접근성 | 상태를 색상만으로 구분하지 않는다. 캔버스의 핵심 작업과 인스펙터를 키보드로 조작할 수 있게 한다 |
| 오류 처리 | 잘못된 입력, 알 수 없는 용량, 무경로를 안전 상태로 바꾸지 않고 원인과 위치를 표시한다 |

## 11. UX 흐름

1. 프리셋 토폴로지를 하나 연다 (예: 리프-스파인 2:1, 단일 랙 웹 서비스, 블록체인 노드 클러스터)
2. 워크로드 프리셋을 고르고 규모 슬라이더를 올린다
3. 사용률이 100%에 닿는 장비가 강조되고, **어느 축인지**가 함께 뜬다
4. 인스펙터에서 그 장비의 축별 막대를 본다. 대역폭 11%, CPS 87%처럼. 각 한계값 옆에 적용 조건과 출처 배지가 붙는다
5. `unknown` 축과 적용 조건이 다른 한계값을 확인하고, 필요한 경우 실측값으로 덮어쓴다
6. 장비를 비활성화한다. 재경로, 과부하, 단절된 demand를 즉시 확인한다
7. 기준 시나리오와 장애 시나리오의 결과와 계산 근거를 JSON으로 내보낸다

## 12. breakscale과의 관계

| | breakscale | 본 도구 |
|---|---|---|
| 모델 단위 | 논리 컴포넌트 (캐시, 큐, DB) | 물리 장비 (스위치, 방화벽, 서버) |
| 자원 | 사실상 단일 축 (슬롯) | 다차원 (bps/pps/CPS/세션/IOPS/전력) |
| 핵심 질문 | 큐가 어떻게 차오르나 | 어느 한계에 먼저 닿나 |
| 계산 | 이산사건 시뮬레이션 | 정상 상태 제약 계산 (Phase 1) |
| 검증 근거 | 대기행렬 이론 닫힌 해 | 벤더 데이터시트 + 실측 |
| 장애 단위 | 노드 crash | 물리 장애 도메인 (랙, 전원, AZ) |
| 대상 | 시스템 디자인 학습자 | 인프라 엔지니어, SRE |

포크가 아니라 별도 프로젝트로 본다. 엔진 구조는 공유할 게 거의 없다.

## 13. 결정 사항과 미결 사항

### 결정됨 (v0.4)

**Phase 1은 단일 데이터센터의 네트워크 경로와 랙 물리 제약으로 한정한다.** WAN, 제어 평면, 서버 연산, Storage 성능은 제외한다.

**트래픽의 표준 입력은 부하 벡터다.** 프리셋의 고수준 입력에서 파생할 때는 공식과 가정을 저장한다.

**Phase 1 경로 분배는 결정적이다.** 지정 경로를 우선하고, 최소 비용 ECMP와 LAG는 균등 분배한다. 무경로 demand는 `unreachable`로 남긴다.

**누락되거나 조건이 맞지 않는 용량은 `unknown`이다.** 자동 보간하거나 0% 사용률로 바꾸지 않는다.

**출처 종류는 적용 가능성보다 우선하지 않는다.** 현재 조건에 맞는 후보 안에서만 출처와 반복 측정 품질을 비교한다.

**제품명은 Rack Mesh다.** 화면과 문서에서는 `Rack Mesh`, 저장소·패키지·CLI 식별자에는 `rack-mesh`를 쓴다. `Rack`은 장비와 물리 제약을, `Mesh`는 장비·링크·경로의 연결 관계를 나타낸다. 계산값 이름 `headroom`은 유지한다.

### 이전 결정

**장비는 실명으로 표기한다.** 익명 클래스 안은 폐기. 8절의 원칙을 지키는 조건으로 진행한다.

**데이터 모델을 물리층과 성능층으로 나눈다.** 물리층은 devicetype-library(CC0)를 임포트하고, 성능층만 직접 만든다.

**엔진과 데이터를 별도 저장소로 분리한다.**

**이전 제품명 Headroom은 폐기했다.** 다른 곳에서 쓰이는 이름이라 제품 식별자로 사용하지 않는다.

### 미결

**이름 가용성.** 2026-09-02 조회에서 `rack-mesh`와 정확히 일치하는 npm·PyPI 패키지와 공개 GitHub 사용자·조직·저장소는 발견되지 않았다. registry RDAP 조회에서는 `rack-mesh.com`, `rack-mesh.dev`, `rack-mesh.io`, `rack-mesh.tools`가 등록되지 않은 것으로 응답했다. 일반 웹 검색에서는 동일한 소프트웨어 제품을 발견하지 못했지만, 물류용 rack mesh deck 같은 일반 용례가 있다. 자동 조회 결과는 등록 가능성이나 상표권을 보장하지 않는다. 미국 USPTO와 WIPO 검색은 자동 검증하지 못했으므로 공개 전 전문가가 대상 국가와 상품류를 확인해야 한다.

**라이선스.** 엔진과 데이터 저장소의 라이선스를 각각 정해야 한다. 데이터 저장소는 CC0나 CC-BY가 자연스럽다(업스트림이 CC0).

**성능 데이터 수집 방식.** 초기 30종을 누가 어떻게 채울지. 제3자 테스트 보고서(NSS Labs류, RFC 2544/3511 기반 리포트)를 근거로 쓸 수 있는지 확인 필요.

**경로 입력 방식.** 정적 경로를 UI에서 직접 지정할지, 라우팅 테이블 임포트를 지원할지 결정해야 한다. Phase 1 계산 계약은 두 방식 모두 수용한다.

**전력 기준.** 랙 예산에 nameplate, typical, measured 중 어떤 값을 기본 적용할지 결정해야 한다. 값의 종류를 섞지 않는 원칙은 확정한다.

## 14. 성공 지표

### Alpha 종료 기준

- 9절의 golden scenario와 불변조건 테스트를 모두 통과한다.
- 성능 프로필 10종 이상을 제공하고, 모든 한계값에 조건과 출처가 있다.
- 10절의 재계산 지연 목표를 고정된 benchmark에서 충족한다.
- 저장한 프로젝트를 다시 불러오면 입력과 계산 결과가 의미상 동일하다.
- 용량 누락과 무경로가 안전 상태로 표시되는 사례가 없다.

### Beta 90일 지표

- 서로 다른 3개 팀이 실제 설계 리뷰 또는 증설 검토에 사용한다.
- 사용자가 실측 override를 저장한 프로젝트가 5개 이상 생긴다.
- 조건이 일치하는 실측 사례 10개 이상에서 축별 오차를 기록한다. MAPE 20% 이하는 잠정 목표이며, 첫 표본을 확보한 뒤 조정한다.
- 성능 프로필 30종 이상을 제공하고, 외부 기여자가 3종 이상을 추가한다.
- 설계 리뷰 결과를 바꾼 병목 또는 장애 발견 사례를 3건 이상 확보한다.

---

## 부록 A. 참고 자료

- [breakscale](https://github.com/xevrion/breakscale)
- [NetBox devicetype-library](https://github.com/netbox-community/devicetype-library) — 물리 장비 데이터와 라이선스는 도입 시점에 다시 확인
- [Device-Type-Library-Import](https://github.com/netbox-community/Device-Type-Library-Import)
- [RFC 2544](https://www.rfc-editor.org/rfc/rfc2544) — 네트워크 장비 benchmark 방법의 참고점
- [RFC 3511](https://www.rfc-editor.org/rfc/rfc3511) — 방화벽 성능 측정 방법의 참고점
- ns-3, OMNeT++/INET — 패킷 레벨 시뮬레이터. 비목표 범위의 참조점

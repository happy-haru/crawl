# 📚 OAPEN/DOAB 오픈액세스 라이선스 기반 다운로더

원본 CSV의 용량이 방대하고 요청 제한(Rate-limit) 회피 목적으로 지연(6~15초)을 포함하기 때문에 **전체 수집에 며칠이 소요**될 수 있습니다. 이를 효율적으로 처리하기 위해 **"포함 (Allowed)" 그룹과 "애매한 (Ambiguous)" 그룹을 서로 다른 두 대의 컴퓨터에서 나눠서 병렬 실행**하도록 설계되었습니다.

---

## 🔧 요구사항

- **Node.js 18 이상** (fetch API 내장 필요)
- **Git** (소스 공유용)
- **원본 CSV 파일**: `repository-export.csv`

---

## 🚀 빠른 시작 가이드 (2대의 컴퓨터 협업)

### 전체 공통 사전 작업

**각 컴퓨터**에서 다음 과정을 똑같이 진행합니다.

#### 1단계 — 저장소 클론

```bash
git clone https://github.com/happy-haru/crawl.git
cd crawl
```

#### 2단계 — 원본 CSV 배치

원본 CSV(`repository-export.csv`, 약 280MB)를 프로젝트 루트 폴더에 복사합니다.
```text
crawl/
└─ repository-export.csv   ← 여기에 복사 (대용량이라 Git에서 제외됨)
```

#### 3단계 — 데이터 분할 (스크립트 실행)

아래 명령으로 전체 CSV를 각각의 카테고리별로 분할합니다.

```bash
npm run filter
```
> 결과로 다음 3개 파일이 생성됩니다.
> - `repository-export-allowed.csv` (포함 대상 35,000건)
> - `repository-export-ambiguous.csv` (애매한 대상 17,000건)
> - `repository-export-excluded.csv` (제외 대상)

---

### 다운로드 실행 (컴퓨터 분리)

서버 차단을 막기 위해 한 컴퓨터에서 동시에 돌리지 말고, **A 컴퓨터는 Allowed, B 컴퓨터는 Ambiguous**를 맡아서 실행하시길 권장합니다.

**💻 컴퓨터 A (포함 대상 담당 시)**
```bash
npm run start:allowed
```
→ `crawl_data/allowed/` 폴더에 다운로드가 진행됩니다.

**💻 컴퓨터 B (애매한 대상 담당 시)**
```bash
npm run start:ambiguous
```
→ `crawl_data/ambiguous/` 폴더에 다운로드가 진행됩니다.

> 🔁 **이어받기**: 중간에 `Ctrl+C`나 절전모드 등으로 중단되어도 동일한 명령어(`npm run start:allowed` 등)를 다시 실행하면 진행했던 부분부터 알아서 이어서 받습니다.

---

## 📁 획득되는 폴더 구조

두 컴퓨터의 작업이 끝나면 각각 다음과 같은 구조의 데이터가 나옵니다.

**컴퓨터 A (Allowed)**
```text
crawl_data/allowed/
├─ files/                      # 원문 다운로드 파일 (PDF, EPUB 등)
├─ metadata/                   # 파일별 JSON 목록
├─ failed/                     # 다운로드 실패한 항목의 메타 및 JSONL 관리
├─ resources_metadata.jsonl    # 정상 다운로드 전체 통합 JSONL
└─ _progress.json              # 이어받기 상태값
```

**컴퓨터 B (Ambiguous)**
```text
crawl_data/ambiguous/
├─ files/                      
├─ metadata/                   
├─ failed/                     
├─ resources_metadata.jsonl    
└─ _progress.json              
```

작업 종료 후, 이 두 폴더를 하나의 USB 등으로 합치시면 전체 수집이 완성됩니다.

---

## �️ 적용된 안티봇 (Anti-Bot) 처리 내용

대규모 크롤링 시 차단당하지 않도록 다음 조치가 적용되었습니다:
- **요청 간 무작위 지연**: 각 6초 ~ 15초 사이 무작위 (서버 보호)
- **로테이션 User-Agent**: Safari, Chrome, Edge 등 6종의 일반 브라우저 헤더를 번갈아 사용
- **자동 백오프 재시도 (Exponential Backoff)**: 403, 404 외에 429(Rate Limit)나 5xx 에러 발생 시, 점진적으로 대기시간을 늘려(10s -> 20s -> 40s) 재시도
- **Referer 스푸핑**: 유입 출처를 구글 검색엔진으로 인식되게 헤더 변조

# 📚 OAPEN/DOAB 오픈액세스 도서 크롤러

오픈액세스 도서 저장소(OAPEN, DOAB 등)에서 **라이선스 기반 필터링** 후  
원문 파일 다운로드 + 메타데이터(JSONL)를 자동 수집하는 Node.js 크롤러입니다.

---

## 🔧 요구사항

- **Node.js 18 이상** (fetch API 내장 필요)
- **Git** (소스 관리용)
- **원본 CSV 파일**: `repository-export.csv` (OAPEN/DOAB에서 export한 파일)

---

## 🚀 빠른 시작 가이드 (다른 컴퓨터에서 작업 시)

### 1단계 — 저장소 클론

```bash
git clone https://github.com/<YOUR_USERNAME>/crawl.git
cd crawl
```

### 2단계 — 원본 CSV 배치

원본 CSV 파일(`repository-export.csv`)은 용량이 커서 Git에 포함되지 않습니다.  
아래 경로에 수동으로 복사해 주세요:

```
crawl/
└─ repository-export.csv   ← 여기에 배치
```

> 💡 **팁**: Google Drive, OneDrive, USB 등으로 옮기세요. (약 280MB)

### 3단계 — 라이선스 필터링 실행

원본 CSV를 "포함 가능 / 제외 / 애매" 3개 카테고리로 분류합니다:

```bash
npm run filter
```

출력 파일:
- `repository-export-filtered.csv` → 포함 가능 + 애매 (다운로드 대상)
- `repository-export-excluded.csv` → 제외 대상

### 4단계 — 테스트 다운로드 (선택)

실제 다운로드 전에 5건씩 시범 수집합니다:

```bash
npm test
```

### 5단계 — 전체 다운로드 실행

```bash
npm start
```

> ⏱ 약 52,000건 × 평균 10초 = **약 6일** 소요 예상  
> 🔁 `Ctrl+C`로 중단해도 `_progress.json` 덕분에 **다시 실행 시 이어서 진행**됨

---

## 📁 출력 폴더 구조

```
crawl_data/
├─ allowed/                    # ✅ 포함 가능 (CC BY 등)
│  ├─ files/                   # 원문 파일 (PDF, EPUB, HTML 등)
│  ├─ metadata/                # 파일별 개별 메타 JSON
│  └─ resources_metadata.jsonl # 통합 JSONL
├─ ambiguous/                  # ⚠️ 애매한 라이선스
│  ├─ files/
│  ├─ metadata/
│  └─ resources_metadata.jsonl
├─ failed/                     # ❌ 다운로드 실패 건
│  ├─ *.json                   # 실패 건별 메타
│  └─ failed_downloads.jsonl   # 실패 통합 JSONL
└─ _progress.json              # 이어받기 상태 파일
```

---

## 🛡️ 안티봇 탐지 회피 전략

| 항목 | 설정 |
|------|------|
| 요청 간 지연 | 6~15초 랜덤 |
| User-Agent | 6종 로테이션 (Chrome/Firefox/Safari/Edge) |
| Referer | `google.com` 스푸핑 |
| 실패 재시도 | 최대 3회, 지수적 백오프 (10s → 20s → 40s + jitter) |
| 429/5xx 대응 | 자동 백오프 후 재시도 |
| 이어받기 | `_progress.json` 기반 Resume |

---

## 📋 메타데이터 필드 설명

각 건의 JSON에는 다음 필드가 포함됩니다:

| 필드 | 설명 | 예시 |
|------|------|------|
| `title` | 제목 | `"Human Cultures..."` |
| `source_site` | 출처 도메인 | `"directory.doabooks.org"` |
| `source_page_url` | 상세페이지 URL | `https://...` |
| `download_url` | 원문 다운로드 URL | `https://...pdf` |
| `license_raw` | 라이선스 원문 | `"https://creativecommons.org/licenses/by/4.0/"` |
| `file_format` | 파일 포맷 | `"pdf"` |
| `download_status` | 처리 결과 | `"success"` / `"failed"` |
| `download_status_reason` | 실패 사유 | `"HTTP 404"` |
| `downloaded_at` | 다운로드 시점 | `"2026-02-24T11:13:25Z"` |
| `authors` | 저자 | `"John Doe"` |
| `publisher` | 출판사 | `"Springer"` |
| `doi` | DOI | `"10.1007/..."` |
| `isbn` | ISBN | `"978..."` |
| `language` | 언어 | `"English[eng]"` |

---

## 🔄 실패한 다운로드 재시도

실패 건만 따로 재시도하려면 `failed/failed_downloads.jsonl`을 참고하여  
해당 URL들을 수동으로 확인하거나 별도의 재시도 스크립트를 실행하세요.

---

## 📜 스크립트 목록

| 파일 | 역할 |
|------|------|
| `filter_csv.js` | 원본 CSV → 라이선스 기준 분류 |
| `downloader.js` | 필터링 결과 기반 파일 다운로드 + 메타 수집 |
| `package.json` | npm 스크립트 단축키 |

---

## ⚠️ 주의사항

- **원본 CSV와 다운로드 데이터는 Git에 포함되지 않습니다** (`.gitignore` 처리됨)
- Node.js 18 미만에서는 `fetch` API가 없어 실행 불가합니다
- 장시간 실행 시 터미널이 닫히지 않도록 `tmux`, `screen`, 또는 `nohup`을 사용하세요:
  ```bash
  nohup node downloader.js > download.log 2>&1 &
  ```

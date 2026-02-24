# 📚 OAPEN/DOAB 오픈액세스 도서 크롤러

라이선스 기반 필터링 후 원문 파일 + JSONL 메타데이터를 수집하는 Node.js 크롤러입니다.  
**"포함 대상"을 절반씩 분할하여 2대의 컴퓨터에서 병렬 다운로드**할 수 있도록 설계되었습니다.

---

## 🔧 요구사항

- **Node.js 18+** (fetch API 내장)
- **원본 CSV**: `repository-export.csv` (OAPEN/DOAB 에서 export)

---

## 🚀 빠른 시작 (각 컴퓨터 공통)

```bash
git clone https://github.com/happy-haru/crawl.git
cd crawl
# repository-export.csv 를 이 폴더에 복사
npm run filter       # CSV를 allowed / ambiguous / excluded 로 분류
npm run split        # allowed를 절반으로 분할 (allowed-1, allowed-2)
```

---

## 💻 2대 컴퓨터 병렬 실행

| 컴퓨터 | 담당 | 명령어 | 예상 건수 |
|--------|------|--------|-----------|
| **A** | 포함 전반부 | `npm run start:allowed-1` | ~17,559건 |
| **B** | 포함 후반부 | `npm run start:allowed-2` | ~17,559건 |

> `ambiguous` (애매한 대상 17,834건)는 나중에 별도 실행:  
> `npm run start:ambiguous`

### 이어받기(Resume)
`Ctrl+C`로 중단 후 같은 명령어를 다시 실행하면 **이전 진행분부터 자동 이어받기**됩니다.

---

## 📁 출력 폴더 구조

```text
crawl_data/
├─ allowed-1/                  # 컴퓨터 A 결과
│  ├─ files/                   # 원문 (PDF, EPUB, HTML 등)
│  ├─ metadata/                # 개별 JSON
│  ├─ failed/                  # 실패 건
│  ├─ resources_metadata.jsonl # 성공 통합 JSONL
│  └─ _progress.json           # 이어받기 상태
├─ allowed-2/                  # 컴퓨터 B 결과
│  └─ (동일 구조)
└─ ambiguous/                  # 애매한 대상
   └─ (동일 구조)
```

---

## 🛡️ 안티봇 설정

| 항목 | 값 |
|------|-----|
| 요청 간 지연 | 6~15초 랜덤 |
| User-Agent | 6종 로테이션 |
| Referer | google.com 스푸핑 |
| 실패 재시도 | 3회, 지수적 백오프 |

---

## 📜 스크립트 목록

| 명령어 | 역할 |
|--------|------|
| `npm run filter` | 원본 CSV → 라이선스별 3분할 |
| `npm run split` | allowed → 절반 2분할 |
| `npm run start:allowed-1` | 포함 전반부 다운로드 |
| `npm run start:allowed-2` | 포함 후반부 다운로드 |
| `npm run start:ambiguous` | 애매한 대상 다운로드 |
| `npm run test:allowed-1` | 전반부 테스트 (5건) |

---

## ⚠️ 주의

- 원본 CSV와 분할 CSV, 다운로드 데이터는 `.gitignore` 처리됨
- 장시간 실행 시 윈도우 **절전 모드를 "안 함"**으로 설정하세요
- `nohup node downloader.js allowed-1 > log.txt 2>&1 &` 형태로 백그라운드 실행 가능

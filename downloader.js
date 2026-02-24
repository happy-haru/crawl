const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// ───────────────────────────── CONFIG ─────────────────────────────
const IS_TEST = process.argv.includes('--test');
const TEST_LIMIT_PER_CATEGORY = 5;

const BASE_DIR = 'd:/antigravity/crawl/crawl_data';
const CSV_PATH = 'd:/antigravity/crawl/repository-export-filtered.csv';

// Anti-Bot settings
const MIN_DELAY_MS = 6000;   // 최소 6초
const MAX_DELAY_MS = 15000;  // 최대 15초
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 10000; // 재시도 기본 대기 10초 (지수적 백오프)
const REQUEST_TIMEOUT_MS = 60000; // 60초 타임아웃

// Rotating User-Agents (실제 브라우저 문자열)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.89 Safari/537.36 Edg/118.0.2088.61',
];

// ───────────────────────────── DIRS ─────────────────────────────
const DIRS = {
    '포함': path.join(BASE_DIR, 'allowed'),
    '애매': path.join(BASE_DIR, 'ambiguous'),
};
const FAILED_DIR = path.join(BASE_DIR, 'failed');

function ensureDirs() {
    for (const cat of Object.values(DIRS)) {
        fs.mkdirSync(path.join(cat, 'files'), { recursive: true });
        fs.mkdirSync(path.join(cat, 'metadata'), { recursive: true });
    }
    fs.mkdirSync(FAILED_DIR, { recursive: true });
}

// ───────────────────────────── RESUME STATE ─────────────────────────────
const PROGRESS_FILE = path.join(BASE_DIR, '_progress.json');

function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); }
        catch { return { done: [] }; }
    }
    return { done: [] };
}

function saveProgress(progress) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));
}

// ───────────────────────────── CSV PARSER ─────────────────────────────
function parseCSVRecord(recordStr) {
    const result = [];
    let curVal = '';
    let inQuotes = false;
    recordStr = recordStr.replace(/\r?\n$/, '');

    for (let i = 0; i < recordStr.length; i++) {
        const ch = recordStr[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < recordStr.length && recordStr[i + 1] === '"') { curVal += '"'; i++; }
                else inQuotes = false;
            } else curVal += ch;
        } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ',') { result.push(curVal); curVal = ''; }
            else curVal += ch;
        }
    }
    result.push(curVal);
    return result;
}

// ───────────────────────────── HELPERS ─────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pickUA = () => USER_AGENTS[randInt(0, USER_AGENTS.length - 1)];

function guessExtFromUrl(url) {
    try {
        const p = new URL(url).pathname;
        const ext = path.extname(p).toLowerCase();
        if (['.pdf', '.epub', '.xml', '.html', '.htm', '.txt', '.zip', '.jpg', '.png'].includes(ext)) return ext;
    } catch { }
    return '';
}

function guessExtFromContentType(ct) {
    if (!ct) return '';
    if (ct.includes('pdf')) return '.pdf';
    if (ct.includes('epub')) return '.epub';
    if (ct.includes('xml')) return '.xml';
    if (ct.includes('html')) return '.html';
    if (ct.includes('plain')) return '.txt';
    if (ct.includes('zip')) return '.zip';
    return '';
}

function safeDomain(url) {
    try { return new URL(url).hostname; }
    catch { return 'unknown'; }
}

// ───────────────────────────── DOWNLOAD ─────────────────────────────
async function downloadWithRetry(url, destPathBase) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const ua = pickUA();
            const res = await fetch(url, {
                signal: controller.signal,
                redirect: 'follow',
                headers: {
                    'User-Agent': ua,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'identity',      // 압축 비활성 → 안정적 저장
                    'Connection': 'keep-alive',
                    'Referer': 'https://www.google.com/',
                },
            });

            clearTimeout(tid);

            if (!res.ok) {
                const msg = `HTTP ${res.status} ${res.statusText}`;
                if (res.status === 429 || res.status >= 500) {
                    // 서버 과부하/레이트리밋 → 재시도
                    const wait = RETRY_BASE_MS * Math.pow(2, attempt - 1) + randInt(1000, 5000);
                    console.log(`   ⚠ ${msg} – retry ${attempt}/${MAX_RETRIES}, waiting ${(wait / 1000).toFixed(1)}s`);
                    await delay(wait);
                    continue;
                }
                return { success: false, reason: msg };
            }

            // Determine extension
            const ct = res.headers.get('content-type') || '';
            let ext = guessExtFromUrl(url) || guessExtFromContentType(ct) || '.bin';
            const finalPath = destPathBase + ext;

            if (res.body) {
                const ws = fs.createWriteStream(finalPath);
                await pipeline(Readable.fromWeb(res.body), ws);
            } else {
                const buf = Buffer.from(await res.arrayBuffer());
                fs.writeFileSync(finalPath, buf);
            }

            // 파일 크기 검증 (0바이트 방지)
            const stat = fs.statSync(finalPath);
            if (stat.size === 0) {
                fs.unlinkSync(finalPath);
                return { success: false, reason: 'Downloaded file is 0 bytes' };
            }

            return { success: true, finalPath, fileSize: stat.size };

        } catch (err) {
            clearTimeout(tid);
            const msg = err.name === 'AbortError' ? 'Request timed out' : (err.message || String(err));
            if (attempt < MAX_RETRIES) {
                const wait = RETRY_BASE_MS * Math.pow(2, attempt - 1) + randInt(1000, 5000);
                console.log(`   ⚠ ${msg} – retry ${attempt}/${MAX_RETRIES}, waiting ${(wait / 1000).toFixed(1)}s`);
                await delay(wait);
            } else {
                return { success: false, reason: msg };
            }
        }
    }
    return { success: false, reason: 'Max retries exceeded' };
}

// ───────────────────────────── MAIN ─────────────────────────────
async function run() {
    ensureDirs();
    const progress = loadProgress();
    const doneSet = new Set(progress.done);

    const fileStream = fs.createReadStream(CSV_PATH, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let header = [];
    let currentRecord = '';
    const testCounts = { '포함': 0, '애매': 0 };
    const stats = { success: 0, failed: 0, skipped: 0, resumed: 0 };

    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  Downloader – ${IS_TEST ? 'TEST' : 'FULL'} MODE                    ║`);
    console.log(`║  Anti-Bot: ON  │  Delay: ${MIN_DELAY_MS / 1000}–${MAX_DELAY_MS / 1000}s        ║`);
    console.log(`║  Retries: ${MAX_RETRIES}    │  Timeout: ${REQUEST_TIMEOUT_MS / 1000}s         ║`);
    console.log(`╚══════════════════════════════════════════╝\n`);

    for await (const line of rl) {
        currentRecord += line + '\n';
        if ((currentRecord.match(/"/g) || []).length % 2 !== 0) continue;

        const row = parseCSVRecord(currentRecord);
        currentRecord = '';

        if (header.length === 0) { header = row; continue; }

        const getCol = name => { const i = header.indexOf(name); return i !== -1 && i < row.length ? row[i] : ''; };

        const category = getCol('License_Category');
        if (!DIRS[category]) continue;

        if (IS_TEST) {
            if (testCounts[category] >= TEST_LIMIT_PER_CATEGORY) {
                if (testCounts['포함'] >= TEST_LIMIT_PER_CATEGORY && testCounts['애매'] >= TEST_LIMIT_PER_CATEGORY) break;
                continue;
            }
        }

        const id = getCol('id') || `unknown_${Date.now()}`;

        // Resume 체크
        if (doneSet.has(id)) { stats.resumed++; continue; }

        let downloadUrl = (getCol('BITSTREAM Download URL') || '').trim();
        if (downloadUrl.includes('||')) downloadUrl = downloadUrl.split('||')[0].trim();

        const targetDir = DIRS[category];
        testCounts[category]++;

        const total = testCounts['포함'] + testCounts['애매'];
        console.log(`\n[${total}] [${category}] ${id}`);
        console.log(`   Title: ${(getCol('dc.title') || '').substring(0, 60)}`);

        // ── 메타데이터 구성 ──
        const metadata = {
            title: getCol('dc.title'),
            source_site: safeDomain(getCol('dc.identifier.uri') || downloadUrl),
            source_page_url: getCol('dc.identifier.uri'),
            download_url: downloadUrl,
            license_raw: getCol('BITSTREAM License'),
            license_evidence: 'repository-export.csv BITSTREAM License column',
            file_format: '',
            download_status: '',
            download_status_reason: '',
            downloaded_at: new Date().toISOString(),
            source_record_id: id,
            resource_type: getCol('dc.type'),
            authors: getCol('dc.contributor.author'),
            publisher: getCol('dc.publisher') || getCol('publisher.name'),
            doi: getCol('oapen.identifier.doi'),
            isbn: getCol('dc.identifier.isbn') || getCol('BITSTREAM ISBN'),
            language: getCol('dc.language'),
            local_file_name: '',
            note: `[Category: ${category}] ${getCol('License_Reason')}`,
        };

        if (!downloadUrl) {
            metadata.download_status = 'failed';
            metadata.download_status_reason = 'No download URL in CSV';
            metadata.file_format = '';
            stats.failed++;
            console.log(`   ✗ No URL`);
        } else {
            // 랜덤 지연 (Anti-Bot)
            const jitter = randInt(MIN_DELAY_MS, MAX_DELAY_MS);
            console.log(`   ⏳ Waiting ${(jitter / 1000).toFixed(1)}s…`);
            await delay(jitter);

            console.log(`   ↓ ${downloadUrl.substring(0, 80)}…`);
            const destBase = path.join(targetDir, 'files', id);
            const result = await downloadWithRetry(downloadUrl, destBase);

            if (result.success) {
                metadata.download_status = 'success';
                metadata.local_file_name = path.basename(result.finalPath);
                metadata.file_format = path.extname(result.finalPath).replace('.', '');
                stats.success++;
                console.log(`   ✓ ${metadata.local_file_name} (${(result.fileSize / 1024).toFixed(0)} KB)`);
            } else {
                metadata.download_status = 'failed';
                metadata.download_status_reason = result.reason;
                stats.failed++;
                console.log(`   ✗ ${result.reason}`);
            }
        }

        // 개별 메타 JSON 저장
        const metaDir = metadata.download_status === 'failed' ? FAILED_DIR : path.join(targetDir, 'metadata');
        fs.writeFileSync(path.join(metaDir, `${id}.json`), JSON.stringify(metadata, null, 2));

        // JSONL 기록
        const jsonlFile = metadata.download_status === 'failed'
            ? path.join(FAILED_DIR, 'failed_downloads.jsonl')
            : path.join(targetDir, 'resources_metadata.jsonl');
        fs.appendFileSync(jsonlFile, JSON.stringify(metadata) + '\n');

        // 진행 상태 저장 (매 건)
        progress.done.push(id);
        if (total % 10 === 0) saveProgress(progress); // 10건마다 디스크에 기록
    }

    // 마지막 저장
    saveProgress(progress);

    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  COMPLETE                                ║`);
    console.log(`║  Success: ${String(stats.success).padStart(6)}                        ║`);
    console.log(`║  Failed:  ${String(stats.failed).padStart(6)}                        ║`);
    console.log(`║  Skipped (resumed): ${String(stats.resumed).padStart(6)}              ║`);
    console.log(`╚══════════════════════════════════════════╝\n`);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });

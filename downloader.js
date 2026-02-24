const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// ───────────────────────────── CONFIG ─────────────────────────────
const IS_TEST = process.argv.includes('--test');
const MODE = process.argv.find(arg => arg === 'allowed' || arg === 'ambiguous');

if (!MODE) {
    console.error("Please specify a mode. Example: 'node downloader.js allowed' or 'npm run start:allowed'");
    process.exit(1);
}

const TEST_LIMIT = 5;

const BASE_DIR = 'd:/antigravity/crawl/crawl_data';
const CATEGORY = MODE === 'allowed' ? '포함' : '애매';
const CSV_PATH = MODE === 'allowed'
    ? 'd:/antigravity/crawl/repository-export-allowed.csv'
    : 'd:/antigravity/crawl/repository-export-ambiguous.csv';

const TARGET_DIR = path.join(BASE_DIR, MODE);
const FAILED_DIR = path.join(TARGET_DIR, 'failed');

// Anti-Bot settings
const MIN_DELAY_MS = 6000;
const MAX_DELAY_MS = 15000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 10000;
const REQUEST_TIMEOUT_MS = 60000;

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.89 Safari/537.36 Edg/118.0.2088.61',
];

// ───────────────────────────── INIT ─────────────────────────────
function ensureDirs() {
    fs.mkdirSync(path.join(TARGET_DIR, 'files'), { recursive: true });
    fs.mkdirSync(path.join(TARGET_DIR, 'metadata'), { recursive: true });
    fs.mkdirSync(FAILED_DIR, { recursive: true });
}

const PROGRESS_FILE = path.join(TARGET_DIR, '_progress.json');

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
                    'Accept-Encoding': 'identity',
                    'Connection': 'keep-alive',
                    'Referer': 'https://www.google.com/',
                },
            });

            clearTimeout(tid);

            if (!res.ok) {
                const msg = `HTTP ${res.status} ${res.statusText}`;
                if (res.status === 429 || res.status >= 500) {
                    const wait = RETRY_BASE_MS * Math.pow(2, attempt - 1) + randInt(1000, 5000);
                    console.log(`   ⚠ ${msg} – retry ${attempt}/${MAX_RETRIES}, waiting ${(wait / 1000).toFixed(1)}s`);
                    await delay(wait);
                    continue;
                }
                return { success: false, reason: msg };
            }

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

    if (!fs.existsSync(CSV_PATH)) {
        console.error(`ERROR: CSV file not found: ${CSV_PATH}`);
        console.error(`Have you run 'npm run filter' yet?`);
        process.exit(1);
    }

    const fileStream = fs.createReadStream(CSV_PATH, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let header = [];
    let currentRecord = '';
    let countProcessed = 0;
    const stats = { success: 0, failed: 0, skipped: 0, resumed: 0 };

    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  Downloader – MODE: ${MODE.toUpperCase().padEnd(20)} ║`);
    console.log(`║  Type: ${IS_TEST ? 'TEST (5 items)' : 'FULL'}                              ║`);
    console.log(`╚══════════════════════════════════════════╝\n`);

    for await (const line of rl) {
        currentRecord += line + '\n';
        if ((currentRecord.match(/"/g) || []).length % 2 !== 0) continue;

        const row = parseCSVRecord(currentRecord);
        currentRecord = '';

        if (header.length === 0) { header = row; continue; }

        if (IS_TEST && countProcessed >= TEST_LIMIT) break;

        const getCol = name => { const i = header.indexOf(name); return i !== -1 && i < row.length ? row[i] : ''; };

        const id = getCol('id') || `unknown_${Date.now()}`;

        // Resume 체크
        if (doneSet.has(id)) { stats.resumed++; continue; }

        let downloadUrl = (getCol('BITSTREAM Download URL') || '').trim();
        if (downloadUrl.includes('||')) downloadUrl = downloadUrl.split('||')[0].trim();

        countProcessed++;
        console.log(`\n[${countProcessed}] [${CATEGORY}] ${id}`);
        console.log(`   Title: ${(getCol('dc.title') || '').substring(0, 60)}`);

        const metadata = {
            title: getCol('dc.title'),
            source_site: safeDomain(getCol('dc.identifier.uri') || downloadUrl),
            source_page_url: getCol('dc.identifier.uri'),
            download_url: downloadUrl,
            license_raw: getCol('BITSTREAM License'),
            license_evidence: 'repository-export.csv',
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
            note: `[Category: ${CATEGORY}] ${getCol('License_Reason')}`,
        };

        if (!downloadUrl) {
            metadata.download_status = 'failed';
            metadata.download_status_reason = 'No download URL in CSV';
            metadata.file_format = '';
            stats.failed++;
            console.log(`   ✗ No URL`);
        } else {
            const jitter = randInt(MIN_DELAY_MS, MAX_DELAY_MS);
            console.log(`   ⏳ Waiting ${(jitter / 1000).toFixed(1)}s…`);
            await delay(jitter);

            console.log(`   ↓ ${downloadUrl.substring(0, 80)}…`);
            const destBase = path.join(TARGET_DIR, 'files', id);
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

        const metaDir = metadata.download_status === 'failed' ? FAILED_DIR : path.join(TARGET_DIR, 'metadata');
        fs.writeFileSync(path.join(metaDir, `${id}.json`), JSON.stringify(metadata, null, 2));

        const jsonlFile = metadata.download_status === 'failed'
            ? path.join(FAILED_DIR, 'failed_downloads.jsonl')
            : path.join(TARGET_DIR, 'resources_metadata.jsonl');
        fs.appendFileSync(jsonlFile, JSON.stringify(metadata) + '\n');

        progress.done.push(id);
        saveProgress(progress);
    }

    saveProgress(progress);

    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  COMPLETE                                ║`);
    console.log(`║  Success: ${String(stats.success).padStart(6)}                        ║`);
    console.log(`║  Failed:  ${String(stats.failed).padStart(6)}                        ║`);
    console.log(`║  Skipped (resumed): ${String(stats.resumed).padStart(6)}              ║`);
    console.log(`╚══════════════════════════════════════════╝\n`);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });

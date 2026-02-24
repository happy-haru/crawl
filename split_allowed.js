// split_allowed.js
// repository-export-allowed.csv 를 절반으로 쪼개서
//   repository-export-allowed-1.csv (전반부)
//   repository-export-allowed-2.csv (후반부)
// 로 나눕니다.

const fs = require('fs');
const readline = require('readline');

async function run() {
    const src = 'd:/antigravity/crawl/repository-export-allowed.csv';
    if (!fs.existsSync(src)) {
        console.error('ERROR: repository-export-allowed.csv 가 없습니다. 먼저 npm run filter 를 실행하세요.');
        process.exit(1);
    }

    // 1차 패스: 전체 레코드 수 카운트 (헤더 제외)
    console.log('Counting records...');
    const rl1 = readline.createInterface({
        input: fs.createReadStream(src, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    let totalLines = 0;
    let headerLine = '';
    let currentRecord = '';

    for await (const line of rl1) {
        currentRecord += line + '\n';
        if ((currentRecord.match(/"/g) || []).length % 2 !== 0) continue;
        if (!headerLine) {
            headerLine = currentRecord;
        } else {
            totalLines++;
        }
        currentRecord = '';
    }

    const half = Math.ceil(totalLines / 2);
    console.log(`Total records: ${totalLines}`);
    console.log(`Part 1: records 1 – ${half}`);
    console.log(`Part 2: records ${half + 1} – ${totalLines}`);

    // 2차 패스: 실제 분할
    const rl2 = readline.createInterface({
        input: fs.createReadStream(src, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    const out1 = fs.createWriteStream('d:/antigravity/crawl/repository-export-allowed-1.csv', { encoding: 'utf8' });
    const out2 = fs.createWriteStream('d:/antigravity/crawl/repository-export-allowed-2.csv', { encoding: 'utf8' });

    let isHeader = true;
    let count = 0;
    currentRecord = '';

    for await (const line of rl2) {
        currentRecord += line + '\n';
        if ((currentRecord.match(/"/g) || []).length % 2 !== 0) continue;

        if (isHeader) {
            out1.write(currentRecord);
            out2.write(currentRecord);
            isHeader = false;
        } else {
            count++;
            if (count <= half) {
                out1.write(currentRecord);
            } else {
                out2.write(currentRecord);
            }
        }
        currentRecord = '';
    }

    out1.end();
    out2.end();

    console.log(`\nDone!`);
    console.log(`  repository-export-allowed-1.csv  (${half} records)`);
    console.log(`  repository-export-allowed-2.csv  (${totalLines - half} records)`);
}

run().catch(console.error);

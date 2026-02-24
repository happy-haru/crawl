const fs = require('fs');
const readline = require('readline');

function parseCSVRecord(recordStr) {
    const result = [];
    let curVal = '';
    let inQuotes = false;
    // Remove trailing newline added by the accumulator
    if (recordStr.endsWith('\n')) recordStr = recordStr.slice(0, -1);
    if (recordStr.endsWith('\r')) recordStr = recordStr.slice(0, -1);

    for (let i = 0; i < recordStr.length; i++) {
        const char = recordStr[i];
        if (inQuotes) {
            if (char === '"') {
                if (i + 1 < recordStr.length && recordStr[i + 1] === '"') {
                    curVal += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                curVal += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                result.push(curVal);
                curVal = '';
            } else {
                curVal += char;
            }
        }
    }
    result.push(curVal);
    return result;
}

function formatCSVField(val) {
    if (val === undefined || val === null) val = '';
    val = String(val);
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
        val = '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
}

function formatCSVRow(rowArray) {
    return rowArray.map(formatCSVField).join(',');
}

function categorizeLicense(licenseValue) {
    if (!licenseValue || licenseValue.trim() === '') {
        return { category: '애매', reason: '라이선스 정보 없음 (Empty)' };
    }

    const val = licenseValue.toLowerCase();

    // 1. Check for exclusions
    const excludeKeywords = [
        '-nc', '/nc/', 'nc/', 'non-commercial', 'noncommercial',
        '-nd', '/nd/', 'nd/', 'no derivatives', 'noderivs',
        '-sa', '/sa/', 'sa/', 'share alike', 'sharealike'
    ];
    for (const kw of excludeKeywords) {
        if (val.includes(kw)) {
            return { category: '제외', reason: `재외 조건 포함 (${kw})` };
        }
    }

    // 2. Check for inclusions
    const includeKeywords = [
        '/by/', '-by/', 'cc by', 'cc-by', 'public domain', 'publicdomain', 'cc0', 'pdm'
    ];
    for (const kw of includeKeywords) {
        if (val.includes(kw)) {
            return { category: '포함', reason: `허용 라이선스 포함 (${kw})` };
        }
    }

    // 3. Otherwise ambiguous
    return { category: '애매', reason: '명시적 라이선스 키워드 없음 (Unclear/Unconfirmable)' };
}

async function run() {
    const fileStream = fs.createReadStream('d:/antigravity/crawl/repository-export.csv', { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const outFiltered = fs.createWriteStream('d:/antigravity/crawl/repository-export-filtered.csv', { encoding: 'utf8' });
    const outExcluded = fs.createWriteStream('d:/antigravity/crawl/repository-export-excluded.csv', { encoding: 'utf8' });

    let header = [];
    let licenseIdx = -1;
    let currentRecord = '';

    let countTotal = 0;
    let countIncluded = 0;
    let countExcluded = 0;
    let countAmbiguous = 0;

    for await (const line of rl) {
        currentRecord += line + '\n';
        const quotesCount = (currentRecord.match(/"/g) || []).length;
        if (quotesCount % 2 === 0) {
            // Balanced quotes, parse record
            const row = parseCSVRecord(currentRecord);
            currentRecord = '';

            if (header.length === 0) {
                header = row;
                licenseIdx = header.indexOf('BITSTREAM License');

                // Add new columns
                const newHeader = [...header, 'License_Category', 'License_Reason'];
                const headerCsv = formatCSVRow(newHeader) + '\n';
                outFiltered.write(headerCsv);
                outExcluded.write(headerCsv);
                continue;
            }

            countTotal++;
            let licVal = '';
            if (row.length > licenseIdx && licenseIdx !== -1) {
                licVal = row[licenseIdx];
            }

            const { category, reason } = categorizeLicense(licVal);
            const newRow = [...row, category, reason];
            const rowCsv = formatCSVRow(newRow) + '\n';

            if (category === '제외') {
                outExcluded.write(rowCsv);
                countExcluded++;
            } else {
                outFiltered.write(rowCsv);
                if (category === '포함') countIncluded++;
                if (category === '애매') countAmbiguous++;
            }
            if (countTotal % 10000 === 0) {
                console.log(`Processed ${countTotal} records...`);
            }
        }
    }

    outFiltered.end();
    outExcluded.end();

    console.log(`\nProcessing Complete.`);
    console.log(`Total Records: ${countTotal}`);
    console.log(`Included (포함 가능): ${countIncluded}`);
    console.log(`Ambiguous (애매한 경우): ${countAmbiguous}`);
    console.log(`Excluded (제외 대상): ${countExcluded}`);
    console.log(`Filtered data saved to: repository-export-filtered.csv`);
    console.log(`Excluded data saved to: repository-export-excluded.csv`);
}

run().catch(console.error);

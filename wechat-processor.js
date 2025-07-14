const fs = require('fs');
const path = require('path');
const util = require('util');
const csv = require('csv-parser');
const { parse } = require('json2csv');

// --- Configuration ---
const LOG_FILE = 'chatlog.md';
const RULES_FILE = 'rules.json';
const OUTPUT_JSON_FILE = 'ledger_data.json';
const WECHAT_BILLS_DIR = './';
const LEDGER_FILE_PREFIX = '家庭账本';

// --- Logging Setup ---
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
const logToFile = (...args) => {
    const message = util.format(...args);
    logStream.write(message + '\n');
};

// --- Helper Functions ---

const getMerchantKeyword = (merchant) => {
    if (!merchant) return '';
    const match = merchant.match(/^(.*?)(?:\(|（|$)/);
    return match ? match[1].trim() : merchant.trim();
};

const createFingerprint = (date, amount, merchant) => {
    const cleanDate = date.replace(/年|月/g, '-').replace(/日/, '');
    const cleanAmount = Math.abs(parseFloat(amount)).toFixed(2);
    const merchantKeyword = getMerchantKeyword(merchant);
    return `${cleanDate}|${cleanAmount}|${merchantKeyword}`;
};

const readCsv = (filePath) => {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
};

const readWeChatCsv = (filePath) => {
    const weChatHeaders = [
        '交易时间', '交易类型', '交易对方', '商品', '收/支', 
        '金额(元)', '支付方式', '当前状态', '交易单号', '商户单号', '备注'
    ];
    return new Promise((resolve, reject) => {
        const results = []; 
        fs.createReadStream(filePath)
            .pipe(csv({
                skipLines: 16,
                headers: weChatHeaders
            }))
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
};

// --- Main Logic ---

async function processLedger() {
    logToFile('--- Starting Execution ---');
    try {
        // Dynamically find the main ledger file
        const ledgerFiles = fs.readdirSync(WECHAT_BILLS_DIR).filter(f => f.startsWith(LEDGER_FILE_PREFIX) && f.endsWith('.csv'));
        if (ledgerFiles.length === 0) {
            throw new Error(`No main ledger file found starting with "${LEDGER_FILE_PREFIX}".`);
        }
        if (ledgerFiles.length > 1) {
            throw new Error(`Multiple ledger files found. Please keep only one file starting with "${LEDGER_FILE_PREFIX}".`);
        }
        const mainLedgerFile = ledgerFiles[0];
        logToFile(`- Found main ledger file: ${mainLedgerFile}`);

        const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
        const existingLedger = await readCsv(mainLedgerFile);

        const existingFingerprints = new Set();
        existingLedger.forEach(row => {
            const merchantGuess = row['备注'] || row['所购商品'] || '';
            const fingerprint = createFingerprint(row['购买日期'], row['金额（元）'], merchantGuess);
            existingFingerprints.add(fingerprint);
        });

        const wechatBillFiles = fs.readdirSync(WECHAT_BILLS_DIR).filter(f => f.startsWith('wechat_bill') && f.endsWith('.csv'));

        if (wechatBillFiles.length === 0) {
            console.log('ℹ️ No new WeChat bill files to process.');
            fs.writeFileSync(OUTPUT_JSON_FILE, JSON.stringify(existingLedger, null, 2), 'utf8');
            return;
        }

        let newTransactions = [];
        for (const file of wechatBillFiles) {
            const billData = await readWeChatCsv(path.join(WECHAT_BILLS_DIR, file));
            for (const row of billData) {
                if (!row['交易时间'] || row['收/支'] !== '支出') continue;

                const amount = parseFloat(row['金额(元)'].replace('¥', ''));
                const date = new Date(row['交易时间']).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
                const merchant = row['交易对方'];
                const fingerprint = createFingerprint(date, amount, merchant);

                if (!existingFingerprints.has(fingerprint)) {
                    let newTx = {
                        '所购商品': row['商品'] || '未知商品',
                        '数量': '',
                        '购买日期': date,
                        '金额（元）': amount,
                        '类别': '待分类',
                        '备注': merchant,
                        '购物平台': '线下'
                    };
                    for (const rule of rules) {
                        const keywords = Array.isArray(rule.keyword) ? rule.keyword : [rule.keyword];
                        if (keywords.some(k => merchant.includes(k))) {
                            newTx['类别'] = rule.category;
                            newTx['所购商品'] = rule.product;
                            if (rule.platform) newTx['购物平台'] = rule.platform;
                            break;
                        }
                    }
                    newTransactions.push(newTx);
                    existingFingerprints.add(fingerprint);
                }
            }
        }

        if (newTransactions.length === 0) {
            console.log(`✅ Processing complete. No new transactions were found to add.`);
            fs.writeFileSync(OUTPUT_JSON_FILE, JSON.stringify(existingLedger, null, 2), 'utf8');
            return;
        }

        // --- Sort and Write ---
        const combinedLedger = [...existingLedger, ...newTransactions];
        
        // Sort the entire ledger by date in ascending order
        combinedLedger.sort((a, b) => {
            // Create valid Date objects from 'YYYY年M月D日' format
            const dateA = new Date(a['购买日期'].replace('年', '-').replace('月', '-').replace('日', ''));
            const dateB = new Date(b['购买日期'].replace('年', '-').replace('月', '-').replace('日', ''));
            return dateA - dateB;
        });

        const fields = ['所购商品', '数量', '购买日期', '金额（元）', '类别', '备注', '购物平台'];
        const csvOutput = parse(combinedLedger, { fields: fields });

        // Overwrite the main ledger file with the sorted, complete data
        fs.writeFileSync(mainLedgerFile, csvOutput, 'utf8');
        logToFile(`- Overwrote ${mainLedgerFile} with sorted data.`);

        // Generate the final JSON for the dashboard
        fs.writeFileSync(OUTPUT_JSON_FILE, JSON.stringify(combinedLedger, null, 2), 'utf8');
        logToFile(`- Generated ${OUTPUT_JSON_FILE} with ${combinedLedger.length} total records.`);

        console.log(`✅ Processing complete.`);
        console.log(`   - Added ${newTransactions.length} new transactions.`);
        console.log(`   - ${mainLedgerFile} has been updated and sorted.`);
        console.log(`   - Total records are now ${combinedLedger.length}.`);

    } catch (error) {
        console.error(`❌ An error occurred: ${error.message}`);
        logToFile('\n--- ERROR ---');
        logToFile(error.stack);
    } finally {
        logStream.end();
    }
}

processLedger();
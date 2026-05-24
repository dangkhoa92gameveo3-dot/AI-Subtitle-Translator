// DOM Elements
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const controlsSection = document.getElementById('controlsSection');
const fileNameDisplay = document.getElementById('fileName');
const fileStatsDisplay = document.getElementById('fileStats');
const startBtn = document.getElementById('startBtn');
const btnText = document.querySelector('.btn-text');
const btnSpinner = document.getElementById('btnSpinner');
const progressSection = document.getElementById('progressSection');
const progressText = document.getElementById('progressText');
const progressPercent = document.getElementById('progressPercent');
const progressBar = document.getElementById('progressBar');
const logConsole = document.getElementById('logConsole');
const downloadLink = document.getElementById('downloadLink');
const resetBtn = document.getElementById('resetBtn');
const keyInputsContainer = document.getElementById('keyInputsContainer');
const addKeyBtn = document.getElementById('addKeyBtn');

// Variables
let currentFile = null;
let parsedSubtitles = [];
let isTranslating = false;
let currentKeyIndex = 0;
const CHUNK_SIZE = 50;

// --- DYNAMIC API KEY & STORAGE MANAGEMENT ---
function saveSettings() {
    const keys = [];
    keyInputsContainer.querySelectorAll('.api-key-input').forEach(input => {
        const val = input.value.trim();
        if (val) keys.push(val);
    });
    localStorage.setItem('gemini_api_keys', JSON.stringify(keys));
}

function loadSettings() {
    // Load API Keys
    const savedKeys = JSON.parse(localStorage.getItem('gemini_api_keys') || '[]');
    keyInputsContainer.innerHTML = ''; // Clear default
    
    if (savedKeys.length === 0) {
        addKeyRow(); // At least one empty row
    } else {
        savedKeys.forEach(key => addKeyRow(key));
    }
}

function addKeyRow(value = '') {
    const row = document.createElement('div');
    row.className = 'key-row';
    row.innerHTML = `<input type="password" class="api-key-input" value="${value}" placeholder="Nhập API Key mới..."><button class="remove-key-btn" title="Xóa key này">✕</button>`;
    
    row.querySelector('.api-key-input').addEventListener('input', saveSettings);
    keyInputsContainer.appendChild(row);
    return row;
}

addKeyBtn.addEventListener('click', () => {
    const row = addKeyRow();
    row.querySelector('input').focus();
    saveSettings();
});

keyInputsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-key-btn')) {
        const rows = keyInputsContainer.querySelectorAll('.key-row');
        if (rows.length > 1) { 
            e.target.closest('.key-row').remove(); 
            saveSettings();
        } else { 
            alert('Phải giữ lại ít nhất 1 ô nhập Key.'); 
        }
    }
});

// Initialize settings on load
loadSettings();

// --- EVENT LISTENERS ---
uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => { uploadArea.classList.remove('dragover'); });
uploadArea.addEventListener('drop', (e) => {
    e.preventDefault(); uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});
uploadArea.addEventListener('click', () => { fileInput.click(); });
fileInput.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFile(e.target.files[0]); });
startBtn.addEventListener('click', startTranslation);
resetBtn.addEventListener('click', resetApp);

// --- CORE FUNCTIONS ---
function log(msg, isError = false) {
    const p = document.createElement('div');
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (isError) p.classList.add('error');
    logConsole.appendChild(p);
    logConsole.scrollTop = logConsole.scrollHeight;
}

function handleFile(file) {
    if (!file.name.toLowerCase().endsWith('.srt')) { alert('Vui lòng chọn file có định dạng .srt'); return; }
    currentFile = file;
    fileNameDisplay.textContent = `Tên file: ${file.name}`;
    fileStatsDisplay.textContent = `Đang phân tích...`;
    const reader = new FileReader();
    reader.onload = (e) => {
        parseSrt(e.target.result);
        fileStatsDisplay.textContent = `Tổng số dòng phụ đề: ${parsedSubtitles.length}`;
        controlsSection.classList.remove('hidden');
        uploadArea.classList.add('hidden');
        log(`Đã tải file thành công: ${parsedSubtitles.length} dòng phụ đề.`);
    };
    reader.readAsText(file);
}

function parseSrt(rawText) {
    rawText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawBlocks = rawText.split(/\n\s*\n/);
    parsedSubtitles = [];
    rawBlocks.forEach(block => {
        block = block.trim();
        if (!block) return;
        const lines = block.split('\n');
        if (lines.length < 2) return;
        const indexLine = lines[0].trim();
        const timecodeLine = lines[1].trim();
        if (!timecodeLine.includes('-->')) return;
        const textContent = lines.slice(2).join('\n').trim();
        parsedSubtitles.push({
            header: indexLine + '\n' + timecodeLine,
            text: textContent,
            translatedText: ''
        });
    });
}

// ============================================================
// HỆ THỐNG API GEMINI (LUÂN PHIÊN KEY)
// ============================================================

let currentAvailableModels = [];
let currentModelIndex = 0;

function getAllApiKeys() {
    const keys = [];
    keyInputsContainer.querySelectorAll('.api-key-input').forEach(input => {
        const val = input.value.trim();
        if (val) keys.push(val);
    });
    return keys;
}

function getActiveApiKey() {
    const keys = getAllApiKeys();
    if (keys.length === 0) return null;
    if (currentKeyIndex >= keys.length) {
        currentKeyIndex = 0; // Quay vòng
    }
    return keys[currentKeyIndex];
}

function switchApiKey() {
    const keys = getAllApiKeys();
    currentKeyIndex++;
    if (currentKeyIndex < keys.length) {
        currentAvailableModels = [];
        currentModelIndex = 0;
        log(`[⚡ Đổi Key] Chuyển sang Gemini Key ${currentKeyIndex + 1}/${keys.length}`);
    } else {
        currentKeyIndex = 0;
        currentAvailableModels = [];
        currentModelIndex = 0;
        log(`[🔄 Hết vòng Key] Quay lại thử Gemini Key 1 (đợi 5s)`);
    }
}

async function getAvailableModels(apiKey) {
    if (currentAvailableModels.length > 0) return currentAvailableModels;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("API Key không hợp lệ hoặc hết quota.");
        const data = await res.json();
        
        // Ưu tiên các mô hình gemini miễn phí
        const priorities = [
            m => m.name.includes("gemini-2.5-flash"),
            m => m.name.includes("gemini-2.0-flash"),
            m => m.name.includes("gemini-1.5-flash") && !m.name.includes("8b"),
            m => m.name.includes("gemini-1.5-flash-8b"),
            m => m.name.includes("gemini-1.5-pro"),
            m => m.name.includes("gemini-1.0-pro") || m.name.endsWith("gemini-pro"),
            m => m.name.includes("gemini"),
        ];
        
        let validModels = [];
        for (const check of priorities) {
            const target = data.models.find(m => check(m) && m.supportedGenerationMethods?.includes("generateContent"));
            if (target) {
                validModels.push(target.name.split('/').pop());
            }
        }
        
        // Loại bỏ trùng lặp nếu có
        currentAvailableModels = [...new Set(validModels)];
        if (currentAvailableModels.length === 0) throw new Error("Không tìm thấy model Gemini nào khả dụng.");
        return currentAvailableModels;
    } catch (e) {
        throw new Error("Lỗi lấy danh sách Model: " + e.message);
    }
}

// --- MAIN API CALLER ---
async function callTranslationApi(promptText, retries = 15) {
    const key = getActiveApiKey();
    if (!key) throw new Error("Không có API Key nào được nhập!");

    try {
        const models = await getAvailableModels(key);
        if (currentModelIndex >= models.length) {
            currentModelIndex = 0;
        }
        const modelName = models[currentModelIndex];
        
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;
        const payload = {
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.1 }
        };
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `HTTP Error ${response.status}`);
        }
        const data = await response.json();
        let translatedText = data.candidates[0].content.parts[0].text;
        return translatedText.replace(/^```[a-z]*\n/i, '').replace(/\nflug$/i, '').replace(/\n```$/i, '').trim();
    } catch (error) {
        if (retries > 0) {
            const currentModelName = currentAvailableModels[currentModelIndex] || "Gemini";
            log(`Lỗi ${currentModelName}: ${error.message.substring(0, 100)}`, true);
            
            // Nếu lỗi do hết Quota (429), thử chuyển model khác trên CÙNG 1 Key
            const isQuotaError = error.message.toLowerCase().includes("quota") || error.message.includes("429") || error.message.toLowerCase().includes("exhausted");
            if (isQuotaError) {
                currentModelIndex++;
                if (currentModelIndex < currentAvailableModels.length) {
                    log(`=> Thử chuyển sang model: ${currentAvailableModels[currentModelIndex]}`);
                    await new Promise(r => setTimeout(r, 1000));
                    return callTranslationApi(promptText, retries - 1);
                }
            }
            
            // Nếu đã thử hết model của Key này, hoặc lỗi khác -> Đổi Key
            switchApiKey();
            if (currentKeyIndex === 0) {
                await new Promise(r => setTimeout(r, 5000));
            } else {
                await new Promise(r => setTimeout(r, 1000));
            }
            return callTranslationApi(promptText, retries - 1);
        }
        throw error;
    }
}

// ============================================================
// SYSTEM PROMPT
// ============================================================
function getSystemPrompt() {
    return `Bạn là CHUYÊN GIA DỊCH PHIM TRUNG QUỐC với 10 năm kinh nghiệm, thông thạo các thể loại: cung đấu, tu tiên, tiên hiệp, huyền huyễn, drama cổ trang.

NGUYÊN TẮC DỊCH:
- Input gồm nhiều dòng, mỗi dòng bắt đầu bằng [số]. Ví dụ: [1] 不行了
- Output phải giữ nguyên [số] và chỉ thay phần text bằng bản dịch tiếng Việt.
- KHÔNG giải thích. KHÔNG thêm dòng. KHÔNG bớt dòng. KHÔNG thay đổi số trong [].
- Số dòng output PHẢI BẰNG ĐÚNG số dòng input.

NGỮ CẢNH & XƯNG HÔ (CỰC KỲ QUAN TRỌNG):
Đây là phim thể loại tu tiên / cung đấu / huyền huyễn Trung Quốc. Hãy dịch theo ngữ cảnh câu chuyện:
- Xưng hô đúng vai vế: vua/hoàng đế dùng "trẫm", hoàng hậu/phi tần dùng "bản cung", cao nhân dùng "bản tọa/lão phu", đệ tử dùng "đệ tử/con".
- Khi nhân vật nói với bề trên: dùng "ngài/người/bệ hạ/nương nương/sư phụ".
- Khi nhân vật nói với bề dưới hoặc kẻ thù: dùng "ngươi/mi/tên kia".
- Khi nhân vật nữ nói dịu dàng: dùng "thiếp/ta/nô tì".
- Khi nhân vật nam mạnh mẽ: dùng "ta/bản tọa/bản vương".
- Giữ nguyên văn phong cổ trang, trang trọng. KHÔNG dùng ngôn ngữ hiện đại đời thường.
- Các thuật ngữ tu tiên giữ nguyên Hán Việt: cảnh giới, đột phá, kim đan, nguyên anh, hóa thần, luyện khí, trúc cơ, kết đan...
- Chiêu thức/kỹ năng giữ nguyên Hán Việt: vd 天雷斩 -> Thiên Lôi Trảm, 火龙术 -> Hỏa Long Thuật.

Ví dụ Input:
[1] 不行了
[2] 那个地方已经动弹不得了，别想了
[3] 本宫今日就教你做人

Ví dụ Output:
[1] Không được rồi
[2] Chỗ đó không động đậy được nữa rồi, đừng hòng tới nữa
[3] Hôm nay bản cung sẽ dạy ngươi cách làm người

QUY TẮC TÊN NHÂN VẬT & DANH TỪ CỐ ĐỊNH:
- 慕容婉歌 / 慕容婉言 / 慕容宛哥 / 慕容碗哥 / 慕容晚年 / 墨晚哥 -> Mộ Dung Uyển Ca
- 许金龙 -> Hứa Kim Long
- 黑虎 -> Hắc Hổ
- 玄铁龟 -> Huyền Thiết Quy
- 龙族女帝 -> Nữ Đế Long Tộc
- 龙血果 -> Long Huyết Quả
- 灵潭 -> linh đàm
- 妖丹 / 腰单 / 腰丹 -> yêu đan
- 妖兽 -> yêu thú
- 系统 -> hệ thống
- 宿主 -> túc chủ
- 本宫 -> bản cung
- 本座 -> bản tọa
- 纷纷 / 芬芬 -> Phân Phân

Dịch các dòng sau:
`;
}

// ============================================================
// MAIN TRANSLATION
// ============================================================
async function startTranslation() {
    if (parsedSubtitles.length === 0) return;
    const keys = getAllApiKeys();
    if (keys.length === 0) { 
        alert("Vui lòng nhập ít nhất 1 API Key!"); 
        return; 
    }

    isTranslating = true;
    currentKeyIndex = 0;
    activeModelName = null;
    startBtn.disabled = true;
    btnText.textContent = "Đang dịch...";
    btnSpinner.classList.remove('hidden');
    progressSection.classList.remove('hidden');
    logConsole.innerHTML = '';

    const chunks = [];
    for (let i = 0; i < parsedSubtitles.length; i += CHUNK_SIZE) {
        chunks.push({ startIdx: i, endIdx: Math.min(i + CHUNK_SIZE, parsedSubtitles.length) });
    }

    let currentChunkIdx = 0;
    let completedChunks = 0;
    let hasFatalError = false;

    async function processNextChunk() {
        if (currentChunkIdx >= chunks.length || hasFatalError) return;
        const chunkInfo = chunks[currentChunkIdx++];
        const { startIdx, endIdx } = chunkInfo;
        let attempts = 0;
        let success = false;

        let textLines = '';
        for (let i = startIdx; i < endIdx; i++) {
            textLines += `[${i}] ${parsedSubtitles[i].text}\n`;
        }
        const promptText = getSystemPrompt() + textLines;

        while (!success && attempts < 1000 && !hasFatalError) {
            try {
                log(`Đang dịch dòng ${startIdx + 1} đến ${endIdx}... (Thử lần ${attempts + 1})`);
                const result = await callTranslationApi(promptText);

                const translatedLines = result.split('\n');
                for (const line of translatedLines) {
                    const match = line.match(/^\[(\d+)\]\s*(.+)/);
                    if (match) {
                        const idx = parseInt(match[1]);
                        const translated = match[2].trim();
                        if (idx >= 0 && idx < parsedSubtitles.length) {
                            parsedSubtitles[idx].translatedText = translated;
                        }
                    }
                }

                success = true;
                completedChunks++;
                const percent = Math.round((completedChunks / chunks.length) * 100);
                progressText.textContent = `Đang dịch: ${completedChunks} / ${chunks.length} phần`;
                progressPercent.textContent = `${percent}%`;
                progressBar.style.width = `${percent}%`;

            } catch (error) {
                attempts++;
                log(`Lỗi phần ${startIdx+1}-${endIdx}: ${error.message}`, true);
                if (attempts >= 1000) {
                    log(`Đã thử 1000 lần nhưng thất bại. Tiến trình bị dừng.`, true);
                    hasFatalError = true;
                    return;
                }
                // Chỉ còn Gemini, nên chờ 2s rồi thử lại
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        await processNextChunk();
    }

    // Gemini: 3 luồng
    const concurrency = 3;
    log(`Bắt đầu dịch (${chunks.length} phần, ${concurrency} luồng, ${keys.length} Key)...`);
    log(`[BẢO VỆ] Số thứ tự và Timecode được giữ nguyên 100% từ file gốc.`);

    const workers = [];
    for (let i = 0; i < concurrency; i++) workers.push(processNextChunk());
    await Promise.all(workers);

    if (hasFatalError) { finishTranslation(false); return; }
    await verifyAndRetranslate();
}

// ============================================================
// KIỂM TRA & DỊCH LẠI
// ============================================================
function containsChinese(text) { return /[\u4e00-\u9fff]/.test(text); }

function findBadSubtitles() {
    const bad = [];
    for (let i = 0; i < parsedSubtitles.length; i++) {
        const sub = parsedSubtitles[i];
        if (!sub.translatedText || sub.translatedText.trim() === '' || containsChinese(sub.translatedText)) {
            bad.push(i);
        }
    }
    return bad;
}

async function verifyAndRetranslate() {
    const MAX_ROUNDS = 5;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
        const badIndices = findBadSubtitles();
        if (badIndices.length === 0) {
            log(`✅ [KIỂM TRA] Tất cả ${parsedSubtitles.length} dòng đều đã được dịch chuẩn!`);
            finishTranslation(true);
            return;
        }
        log(`⚠️ [KIỂM TRA LẦN ${round}] Phát hiện ${badIndices.length} dòng lỗi. Đang dịch lại...`);
        progressText.textContent = `Kiểm tra lần ${round}: Sửa ${badIndices.length} dòng lỗi...`;
        progressBar.style.width = '50%';
        progressPercent.textContent = `Đang sửa...`;

        const RETRY_CHUNK = 20;
        const retryChunks = [];
        for (let i = 0; i < badIndices.length; i += RETRY_CHUNK) {
            retryChunks.push(badIndices.slice(i, i + RETRY_CHUNK));
        }
        for (let c = 0; c < retryChunks.length; c++) {
            const chunk = retryChunks[c];
            let textLines = '';
            for (const idx of chunk) textLines += `[${idx}] ${parsedSubtitles[idx].text}\n`;
            const promptText = getSystemPrompt() + textLines;
            try {
                log(`   Dịch lại nhóm ${c+1}/${retryChunks.length} (${chunk.length} dòng)...`);
                const result = await callTranslationApi(promptText);
                const translatedLines = result.split('\n');
                for (const line of translatedLines) {
                    const match = line.match(/^\[(\d+)\]\s*(.+)/);
                    if (match) {
                        const idx = parseInt(match[1]);
                        const translated = match[2].trim();
                        if (idx >= 0 && idx < parsedSubtitles.length && !containsChinese(translated) && translated.trim() !== '') {
                            parsedSubtitles[idx].translatedText = translated;
                        }
                    }
                }
            } catch (error) {
                log(`   Lỗi nhóm ${c+1}: ${error.message}`, true);
            }
            await new Promise(r => setTimeout(r, 500));
        }
    }
    const remaining = findBadSubtitles();
    if (remaining.length > 0) {
        log(`⚠️ Vẫn còn ${remaining.length} dòng chưa dịch được. Giữ nguyên text gốc.`, true);
    } else {
        log(`✅ Tất cả dòng đã được dịch chuẩn!`);
    }
    finishTranslation(true);
}

// ============================================================
// FINISH & DOWNLOAD
// ============================================================
function finishTranslation(isSuccess) {
    isTranslating = false;
    startBtn.disabled = false;
    btnText.textContent = "Bắt Đầu Dịch";
    btnSpinner.classList.add('hidden');
    if (isSuccess) {
        log(`Dịch hoàn tất! Đang tạo file tải xuống...`);
        createDownload();
        controlsSection.classList.add('hidden');
        progressSection.classList.add('hidden');
        downloadSection.classList.remove('hidden');
        log(`🎬 Đang phân tích nội dung và tạo tiêu đề YouTube...`);
        generateTitles();
    }
}

function createDownload() {
    let srtOutput = '';
    for (let i = 0; i < parsedSubtitles.length; i++) {
        const sub = parsedSubtitles[i];
        const finalText = sub.translatedText || sub.text;
        srtOutput += sub.header + '\n' + finalText + '\n\n';
    }
    const blob = new Blob([srtOutput.trim()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const nameWithoutExt = currentFile.name.substring(0, currentFile.name.lastIndexOf('.'));
    downloadLink.href = url;
    downloadLink.download = `${nameWithoutExt}_vi.srt`;
}

function resetApp() {
    currentFile = null;
    parsedSubtitles = [];
    fileInput.value = '';
    currentKeyIndex = 0;
    activeModelName = null;
    usingFreeApi = false;
    currentFreeModelIndex = 0;
    uploadArea.classList.remove('hidden');
    controlsSection.classList.add('hidden');
    progressSection.classList.add('hidden');
    downloadSection.classList.add('hidden');
    const titlesSection = document.getElementById('titlesSection');
    const titlesList = document.getElementById('titlesList');
    titlesSection.classList.add('hidden');
    titlesList.innerHTML = '';
    progressBar.style.width = '0%';
    progressText.textContent = `Đang dịch: 0 / 0`;
    progressPercent.textContent = `0%`;
}

// ============================================================
// GỢI Ý TIÊU ĐỀ YOUTUBE
// ============================================================
const titlesSection = document.getElementById('titlesSection');
const titlesLoading = document.getElementById('titlesLoading');
const titlesList = document.getElementById('titlesList');
const copySelectedBtn = document.getElementById('copySelectedBtn');

function getContentSummary() {
    let content = '';
    for (const sub of parsedSubtitles) {
        content += (sub.translatedText || sub.text) + ' ';
        if (content.length > 3000) break;
    }
    return content.trim();
}

async function generateTitles() {
    titlesSection.classList.remove('hidden');
    titlesLoading.classList.remove('hidden');
    titlesList.innerHTML = '';
    const contentSummary = getContentSummary();
    const prompt = `Bạn là chuyên gia YouTube tại thị trường Việt Nam, chuyên về phim Trung Quốc.

Dựa vào nội dung phụ đề phim bên dưới, hãy đề xuất ĐÚNG 20 tiêu đề YouTube.

YÊU CẦU BẮT BUỘC:
1. Tiêu đề phải câu view, ngắn gọn (dưới 70 ký tự).
2. Tuân thủ nguyên tắc cộng đồng YouTube (không bạo lực, không khiêu dâm, không clickbait quá mức).
3. Phù hợp thị trường Việt Nam, dùng từ ngữ gây tò mò cho khán giả Việt.
4. Đánh giá CTR % dự kiến tại thị trường Việt Nam.
5. CHỈ đưa ra những tiêu đề có CTR từ 7% trở lên.

ĐỊNH DẠNG OUTPUT (TUYỆT ĐỐI TUÂN THỦ, KHÔNG GIẢI THÍCH):
Mỗi dòng đúng định dạng: TIÊU ĐỀ ||| CTR%
Ví dụ:
Nữ Đế Long Tộc Bị Đánh Bại, Kẻ Yếu Nhất Lật Kèo ||| 12.5%
Hệ Thống Trả Thưởng Gấp 100 Lần, Cả Thế Giới Sốc ||| 9.8%

NỘI DUNG PHIM:
${contentSummary}`;
    try {
        const result = await callTranslationApi(prompt);
        parseTitlesResult(result);
    } catch (error) {
        titlesList.innerHTML = `<div style="color:#fca5a5;text-align:center;padding:16px;">Lỗi tạo tiêu đề: ${error.message}</div>`;
    }
    titlesLoading.classList.add('hidden');
}

function parseTitlesResult(rawText) {
    titlesList.innerHTML = '';
    const lines = rawText.split('\n').filter(l => l.trim());
    let count = 0;
    for (const line of lines) {
        const parts = line.split('|||');
        if (parts.length < 2) continue;
        const title = parts[0].trim().replace(/^\d+[\.)\]]\s*/, '');
        const ctrValue = parseFloat(parts[1].trim().replace('%', ''));
        if (!title || isNaN(ctrValue) || ctrValue < 7) continue;
        count++;
        const item = document.createElement('div');
        item.className = 'title-item';
        const ctrClass = ctrValue >= 10 ? 'ctr-high' : 'ctr-medium';
        item.innerHTML = `
            <input type="checkbox" class="title-checkbox" data-title="${title.replace(/"/g, '&quot;')}">
            <span class="title-text">${count}. ${title}</span>
            <span class="title-ctr ${ctrClass}">${ctrValue.toFixed(1)}%</span>`;
        item.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return;
            const cb = item.querySelector('.title-checkbox');
            cb.checked = !cb.checked;
            item.classList.toggle('selected', cb.checked);
        });
        item.querySelector('.title-checkbox').addEventListener('change', (e) => {
            item.classList.toggle('selected', e.target.checked);
        });
        titlesList.appendChild(item);
    }
    if (count === 0) {
        titlesList.innerHTML = `<div style="color:#fca5a5;text-align:center;padding:16px;">Không tìm thấy tiêu đề phù hợp.</div>`;
    }
}

copySelectedBtn.addEventListener('click', () => {
    const checked = titlesList.querySelectorAll('.title-checkbox:checked');
    if (checked.length === 0) { alert('Vui lòng chọn ít nhất 1 tiêu đề để copy!'); return; }
    const titles = [];
    checked.forEach(cb => titles.push(cb.dataset.title));
    const textToCopy = titles.join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
        copySelectedBtn.textContent = '✅ Đã copy thành công!';
        copySelectedBtn.classList.add('copied');
        setTimeout(() => { copySelectedBtn.textContent = '📋 Copy các tiêu đề đã chọn'; copySelectedBtn.classList.remove('copied'); }, 2000);
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = textToCopy; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        copySelectedBtn.textContent = '✅ Đã copy thành công!';
        copySelectedBtn.classList.add('copied');
        setTimeout(() => { copySelectedBtn.textContent = '📋 Copy các tiêu đề đã chọn'; copySelectedBtn.classList.remove('copied'); }, 2000);
    });
});

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
const downloadSection = document.getElementById('downloadSection');
const downloadLink = document.getElementById('downloadLink');
const resetBtn = document.getElementById('resetBtn');
const keyInputsContainer = document.getElementById('keyInputsContainer');
const addKeyBtn = document.getElementById('addKeyBtn');

// Variables
let currentFile = null;
let parsedSubtitles = []; // Mảng chứa {index, timecode, text} - TÁCH RIÊNG
let isTranslating = false;
let currentKeyIndex = 0;
const CHUNK_SIZE = 50; // Số subtitle gửi mỗi lần

// --- DYNAMIC API KEY MANAGEMENT ---

function getAllApiKeys() {
    const inputs = keyInputsContainer.querySelectorAll('.api-key-input');
    const keys = [];
    inputs.forEach(input => {
        const val = input.value.trim();
        if (val) keys.push(val);
    });
    return keys;
}

addKeyBtn.addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'key-row';
    row.innerHTML = `
        <input type="password" class="api-key-input" placeholder="Nhập API Key mới...">
        <button class="remove-key-btn" title="Xóa key này">✕</button>
    `;
    keyInputsContainer.appendChild(row);
    row.querySelector('input').focus();
});

keyInputsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-key-btn')) {
        const rows = keyInputsContainer.querySelectorAll('.key-row');
        if (rows.length > 1) {
            e.target.closest('.key-row').remove();
        } else {
            alert('Phải giữ lại ít nhất 1 ô nhập Key.');
        }
    }
});

// --- EVENT LISTENERS ---

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
    }
});

uploadArea.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

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
    if (!file.name.toLowerCase().endsWith('.srt')) {
        alert('Vui lòng chọn file có định dạng .srt');
        return;
    }
    
    currentFile = file;
    fileNameDisplay.textContent = `Tên file: ${file.name}`;
    fileStatsDisplay.textContent = `Đang phân tích...`;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        parseSrt(text);
        fileStatsDisplay.textContent = `Tổng số dòng phụ đề: ${parsedSubtitles.length}`;
        controlsSection.classList.remove('hidden');
        uploadArea.classList.add('hidden');
        log(`Đã tải file thành công: ${parsedSubtitles.length} dòng phụ đề.`);
    };
    reader.readAsText(file);
}

/**
 * PHÂN TÁCH FILE SRT THÀNH CÁC THÀNH PHẦN RIÊNG BIỆT
 * Mỗi subtitle được lưu thành: { header: "1\n00:00:00,333 --> 00:00:01,566", text: "不行了" }
 * Phần header (số + timecode) sẽ KHÔNG BAO GIỜ bị gửi cho AI.
 */
function parseSrt(rawText) {
    rawText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawBlocks = rawText.split(/\n\s*\n/);
    parsedSubtitles = [];
    
    rawBlocks.forEach(block => {
        block = block.trim();
        if (!block) return;
        
        const lines = block.split('\n');
        if (lines.length < 2) return;
        
        // Dòng 1: Số thứ tự
        // Dòng 2: Timecode (chứa -->)
        // Dòng 3+: Nội dung text
        const indexLine = lines[0].trim();
        const timecodeLine = lines[1].trim();
        
        // Kiểm tra dòng timecode hợp lệ
        if (!timecodeLine.includes('-->')) return;
        
        const textLines = lines.slice(2).join('\n').trim();
        
        parsedSubtitles.push({
            header: indexLine + '\n' + timecodeLine, // GIỮ NGUYÊN 100%
            text: textLines,                         // CHỈ PHẦN NÀY ĐƯỢC DỊCH
            translatedText: ''                       // Sẽ được điền sau
        });
    });
}

// --- API ROTATION LOGIC ---

function getActiveApiKey() {
    const keys = getAllApiKeys();
    if (currentKeyIndex < keys.length) {
        return keys[currentKeyIndex];
    }
    return "FREE_FALLBACK";
}

function switchApiKey() {
    const keys = getAllApiKeys();
    currentKeyIndex++;
    
    if (currentKeyIndex < keys.length) {
        log(`[Chuyển đổi] Đã chuyển sang API Key ${currentKeyIndex + 1} / ${keys.length}.`);
    } else if (currentKeyIndex === keys.length) {
        log(`[Hệ thống] Tất cả ${keys.length} Key Gemini đều bị lỗi. TỰ ĐỘNG CHUYỂN SANG AI MIỄN PHÍ DỰ PHÒNG!`);
    } else {
        currentKeyIndex = 0;
        log(`[Hệ thống] Đã quay vòng lại API Key 1.`);
    }
}

let activeModelName = null;

async function getAvailableModel(apiKey) {
    if (activeModelName) return activeModelName;
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error("Không thể lấy danh sách model. API Key có thể không hợp lệ.");
    }
    const data = await res.json();
    
    let target = data.models.find(m => (m.name.endsWith("gemini-1.5-flash") || m.name.endsWith("gemini-1.5-flash-latest")) && m.supportedGenerationMethods?.includes("generateContent"));
    
    if (!target) {
        target = data.models.find(m => (m.name.endsWith("gemini-1.0-pro") || m.name.endsWith("gemini-pro")) && m.supportedGenerationMethods?.includes("generateContent"));
    }
    
    if (!target) {
        target = data.models.find(m => m.name.includes("gemini") && m.supportedGenerationMethods?.includes("generateContent"));
    }
    
    if (target) {
        activeModelName = target.name.split('/').pop();
        log(`Đã tự động chọn Model: ${activeModelName}`);
        return activeModelName;
    }
    throw new Error("API Key không hợp lệ hoặc không có model nào hỗ trợ.");
}

// --- API CALLERS ---

async function callFreeFallbackApi(promptText) {
    const url = `https://text.pollinations.ai/`;
    const payload = {
        messages: [
            { role: "system", content: "Bạn là hệ thống dịch thuật tự động. Dịch từng dòng tiếng Trung sang tiếng Việt. Mỗi dòng input tương ứng 1 dòng output. KHÔNG giải thích, KHÔNG thêm bớt dòng." },
            { role: "user", content: promptText }
        ],
        model: "openai"
    };
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`Fallback API HTTP Error ${response.status}`);
    const text = await response.text();
    return text.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '').trim();
}

async function callTranslationApi(promptText, retries = 10) {
    const key = getActiveApiKey();
    
    if (key === "FREE_FALLBACK") {
        try {
            return await callFreeFallbackApi(promptText);
        } catch (error) {
            if (retries > 0) {
                log(`Lỗi API Dự phòng: ${error.message}. Thử lại...`, true);
                switchApiKey();
                await new Promise(r => setTimeout(r, 5000));
                return callTranslationApi(promptText, retries - 1);
            }
            throw error;
        }
    }

    try {
        const modelName = await getAvailableModel(key);
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;
        
        const payload = {
            contents: [{
                parts: [{ text: promptText }]
            }],
            generationConfig: {
                temperature: 0.1,
            }
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
        translatedText = translatedText.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '').trim();
        return translatedText;

    } catch (error) {
        if (retries > 0) {
            let waitTime = 3000;
            
            const match = error.message.match(/retry in ([\d.]+)s/);
            if (match && match[1]) {
                waitTime = (parseFloat(match[1]) * 1000) + 1000;
            } else if (error.message.includes('quota') || error.message.includes('exceeded')) {
                waitTime = 15000;
            }

            log(`Lỗi API: ${error.message.substring(0, 120)}...`, true);
            log(`=> Chờ ${(waitTime/1000).toFixed(0)}s rồi đổi Key...`);
            
            await new Promise(r => setTimeout(r, waitTime));
            switchApiKey();
            activeModelName = null;
            
            return callTranslationApi(promptText, retries - 1);
        }
        throw error;
    }
}

// --- SYSTEM PROMPT (CHỈ DỊCH TEXT THUẦN, KHÔNG CÓ SỐ/TIMECODE) ---

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

// --- MAIN TRANSLATION (CHỈ GỬI TEXT, GIỮ NGUYÊN SỐ/TIMECODE) ---

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
    
    // Chia subtitles thành các chunk
    const chunks = [];
    for (let i = 0; i < parsedSubtitles.length; i += CHUNK_SIZE) {
        chunks.push({
            startIdx: i,
            endIdx: Math.min(i + CHUNK_SIZE, parsedSubtitles.length)
        });
    }
    
    const CONCURRENCY_LIMIT = 3;
    let currentChunkIdx = 0;
    let completedChunks = 0;
    let hasFatalError = false;

    async function processNextChunk() {
        if (currentChunkIdx >= chunks.length || hasFatalError) return;
        
        const chunkInfo = chunks[currentChunkIdx++];
        const { startIdx, endIdx } = chunkInfo;
        let attempts = 0;
        let success = false;
        
        // Tạo prompt CHỈ CHỨA TEXT (có đánh số để map lại)
        let textLines = '';
        for (let i = startIdx; i < endIdx; i++) {
            textLines += `[${i}] ${parsedSubtitles[i].text}\n`;
        }
        
        const promptText = getSystemPrompt() + textLines;
        
        while (!success && attempts < 3 && !hasFatalError) {
            try {
                log(`Đang dịch dòng ${startIdx + 1} đến ${endIdx}...`);
                
                const result = await callTranslationApi(promptText);
                
                // Parse kết quả: tìm các dòng [số] text
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
                log(`Lỗi khi dịch phần ${startIdx+1}-${endIdx}: ${error.message}`, true);
                if (attempts >= 3) {
                    log(`Đã thử 3 lần nhưng thất bại. Tiến trình bị dừng.`, true);
                    hasFatalError = true;
                    return;
                }
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        await processNextChunk();
    }

    log(`Bắt đầu dịch (${chunks.length} phần, ${CONCURRENCY_LIMIT} luồng, ${keys.length} Key)...`);
    log(`[BẢO VỆ] Số thứ tự và Timecode được giữ nguyên 100% từ file gốc.`);
    
    const workers = [];
    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        workers.push(processNextChunk());
    }
    
    await Promise.all(workers);
    
    if (hasFatalError) {
        finishTranslation(false);
        return;
    }
    
    // --- KIỂM TRA VÀ DỊCH LẠI CÁC DÒNG BỊ LỖI ---
    await verifyAndRetranslate();
}

/**
 * Kiểm tra xem một dòng text có còn chứa chữ Trung (CJK) không.
 * Trả về true nếu dòng text vẫn còn tiếng Trung chưa được dịch.
 */
function containsChinese(text) {
    // CJK Unified Ideographs range
    return /[\u4e00-\u9fff]/.test(text);
}

/**
 * Tìm tất cả các dòng phụ đề bị lỗi:
 * 1. Chưa được dịch (translatedText rỗng)
 * 2. Vẫn còn chứa chữ Trung (AI trả lại nguyên văn hoặc dịch thiếu)
 */
function findBadSubtitles() {
    const badIndices = [];
    for (let i = 0; i < parsedSubtitles.length; i++) {
        const sub = parsedSubtitles[i];
        if (!sub.translatedText || sub.translatedText.trim() === '') {
            badIndices.push(i);
        } else if (containsChinese(sub.translatedText)) {
            badIndices.push(i);
        }
    }
    return badIndices;
}

/**
 * KIỂM TRA LẠI LẦN CUỐI & DỊCH LẠI CÁC DÒNG BỊ LỖI
 * Lặp lại tối đa MAX_VERIFY_ROUNDS vòng cho đến khi tất cả đều chuẩn.
 */
async function verifyAndRetranslate() {
    const MAX_VERIFY_ROUNDS = 5;
    
    for (let round = 1; round <= MAX_VERIFY_ROUNDS; round++) {
        const badIndices = findBadSubtitles();
        
        if (badIndices.length === 0) {
            log(`✅ [KIỂM TRA] Tất cả ${parsedSubtitles.length} dòng đều đã được dịch chuẩn!`);
            finishTranslation(true);
            return;
        }
        
        log(`⚠️ [KIỂM TRA LẦN ${round}] Phát hiện ${badIndices.length} dòng bị lỗi. Đang dịch lại...`);
        
        // Cập nhật thanh tiến trình
        progressText.textContent = `Kiểm tra lần ${round}: Sửa ${badIndices.length} dòng lỗi...`;
        progressBar.style.width = '50%';
        progressPercent.textContent = `Đang sửa...`;
        
        // Chia các dòng lỗi thành chunk nhỏ (20 dòng/lần để AI tập trung hơn)
        const RETRY_CHUNK_SIZE = 20;
        const retryChunks = [];
        for (let i = 0; i < badIndices.length; i += RETRY_CHUNK_SIZE) {
            retryChunks.push(badIndices.slice(i, i + RETRY_CHUNK_SIZE));
        }
        
        for (let c = 0; c < retryChunks.length; c++) {
            const chunk = retryChunks[c];
            
            let textLines = '';
            for (const idx of chunk) {
                textLines += `[${idx}] ${parsedSubtitles[idx].text}\n`;
            }
            
            const promptText = getSystemPrompt() + textLines;
            
            try {
                log(`   Đang dịch lại nhóm ${c + 1}/${retryChunks.length} (${chunk.length} dòng)...`);
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
                log(`   Lỗi khi dịch lại nhóm ${c + 1}: ${error.message}`, true);
            }
            
            // Delay nhỏ giữa các lần gọi
            await new Promise(r => setTimeout(r, 500));
        }
    }
    
    // Sau MAX_VERIFY_ROUNDS vòng, kiểm tra lần cuối
    const remaining = findBadSubtitles();
    if (remaining.length > 0) {
        log(`⚠️ [KẾT QUẢ] Vẫn còn ${remaining.length} dòng chưa dịch được sau ${MAX_VERIFY_ROUNDS} vòng kiểm tra. Các dòng này sẽ giữ nguyên text gốc.`, true);
    } else {
        log(`✅ [KIỂM TRA] Tất cả dòng đã được dịch chuẩn!`);
    }
    
    finishTranslation(true);
}

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
        
        // Tự động tạo gợi ý tiêu đề YouTube
        log(`🎬 Đang phân tích nội dung và tạo tiêu đề YouTube...`);
        generateTitles();
    }
}

/**
 * TẠO FILE SRT HOÀN CHỈNH
 * Ghép: header GỐC (số + timecode) + text ĐÃ DỊCH
 * => Đảm bảo tuyệt đối số và timecode KHÔNG BAO GIỜ bị thay đổi
 */
function createDownload() {
    let srtOutput = '';
    
    for (let i = 0; i < parsedSubtitles.length; i++) {
        const sub = parsedSubtitles[i];
        const finalText = sub.translatedText || sub.text; // Nếu chưa dịch được thì giữ text gốc
        
        srtOutput += sub.header + '\n' + finalText + '\n\n';
    }
    
    const blob = new Blob([srtOutput.trim()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const originalName = currentFile.name;
    const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.'));
    const newName = `${nameWithoutExt}_vi.srt`;
    
    downloadLink.href = url;
    downloadLink.download = newName;
}

function resetApp() {
    currentFile = null;
    parsedSubtitles = [];
    fileInput.value = '';
    currentKeyIndex = 0;
    activeModelName = null;
    
    uploadArea.classList.remove('hidden');
    controlsSection.classList.add('hidden');
    progressSection.classList.add('hidden');
    downloadSection.classList.add('hidden');
    
    // Reset titles section
    const titlesSection = document.getElementById('titlesSection');
    const titlesList = document.getElementById('titlesList');
    titlesSection.classList.add('hidden');
    titlesList.innerHTML = '';
    
    progressBar.style.width = '0%';
    progressText.textContent = `Đang dịch: 0 / 0`;
    progressPercent.textContent = `0%`;
}

// ============================================================
// TÍNH NĂNG GỢI Ý TIÊU ĐỀ YOUTUBE
// ============================================================

const titlesSection = document.getElementById('titlesSection');
const titlesLoading = document.getElementById('titlesLoading');
const titlesList = document.getElementById('titlesList');
const copySelectedBtn = document.getElementById('copySelectedBtn');

/**
 * Lấy tóm tắt nội dung từ các phụ đề đã dịch (tối đa 3000 ký tự)
 */
function getContentSummary() {
    let content = '';
    for (const sub of parsedSubtitles) {
        const text = sub.translatedText || sub.text;
        content += text + ' ';
        if (content.length > 3000) break;
    }
    return content.trim();
}

/**
 * Gọi AI để tạo 20 tiêu đề YouTube
 */
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

/**
 * Parse kết quả từ AI thành danh sách tiêu đề + CTR
 */
function parseTitlesResult(rawText) {
    titlesList.innerHTML = '';
    const lines = rawText.split('\n').filter(l => l.trim());
    let count = 0;
    
    for (const line of lines) {
        // Tìm pattern: Tiêu đề ||| CTR%
        const parts = line.split('|||');
        if (parts.length < 2) continue;
        
        const title = parts[0].trim().replace(/^\d+[\.\)]\s*/, ''); // Bỏ số đầu dòng nếu có
        let ctrText = parts[1].trim().replace('%', '');
        const ctrValue = parseFloat(ctrText);
        
        if (!title || isNaN(ctrValue)) continue;
        if (ctrValue < 7) continue; // Chỉ lấy CTR >= 7%
        
        count++;
        
        const item = document.createElement('div');
        item.className = 'title-item';
        
        const ctrClass = ctrValue >= 10 ? 'ctr-high' : 'ctr-medium';
        
        item.innerHTML = `
            <input type="checkbox" class="title-checkbox" data-title="${title.replace(/"/g, '&quot;')}">
            <span class="title-text">${count}. ${title}</span>
            <span class="title-ctr ${ctrClass}">${ctrValue.toFixed(1)}%</span>
        `;
        
        // Click vào item cũng toggle checkbox
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
        titlesList.innerHTML = `<div style="color:#fca5a5;text-align:center;padding:16px;">Không tìm thấy tiêu đề phù hợp. Vui lòng thử lại.</div>`;
    }
}

/**
 * Copy các tiêu đề đã chọn vào clipboard
 */
copySelectedBtn.addEventListener('click', () => {
    const checked = titlesList.querySelectorAll('.title-checkbox:checked');
    
    if (checked.length === 0) {
        alert('Vui lòng chọn ít nhất 1 tiêu đề để copy!');
        return;
    }
    
    const titles = [];
    checked.forEach(cb => {
        titles.push(cb.dataset.title);
    });
    
    const textToCopy = titles.join('\n');
    
    navigator.clipboard.writeText(textToCopy).then(() => {
        copySelectedBtn.textContent = '✅ Đã copy thành công!';
        copySelectedBtn.classList.add('copied');
        setTimeout(() => {
            copySelectedBtn.textContent = '📋 Copy các tiêu đề đã chọn';
            copySelectedBtn.classList.remove('copied');
        }, 2000);
    }).catch(() => {
        // Fallback cho trình duyệt cũ
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copySelectedBtn.textContent = '✅ Đã copy thành công!';
        copySelectedBtn.classList.add('copied');
        setTimeout(() => {
            copySelectedBtn.textContent = '📋 Copy các tiêu đề đã chọn';
            copySelectedBtn.classList.remove('copied');
        }, 2000);
    });
});

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
    return `Bạn là CÔNG CỤ DỊCH THUẬT TỰ ĐỘNG. Dịch tiếng Trung sang tiếng Việt.

BẮT BUỘC:
- Input gồm nhiều dòng, mỗi dòng bắt đầu bằng [số]. Ví dụ: [1] 不行了
- Output phải giữ nguyên [số] và chỉ thay phần text bằng bản dịch tiếng Việt.
- KHÔNG giải thích. KHÔNG thêm dòng. KHÔNG bớt dòng. KHÔNG thay đổi số trong [].
- Số dòng output PHẢI BẰNG ĐÚNG số dòng input.

Ví dụ Input:
[1] 不行了
[2] 那个地方已经动弹不得了，别想了

Ví dụ Output:
[1] Không được rồi
[2] Chỗ đó không động đậy được nữa rồi, đừng hòng tới nữa

QUY TẮC TÊN NHÂN VẬT & DANH TỪ:
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
    } else {
        finishTranslation(true);
    }
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
    
    progressBar.style.width = '0%';
    progressText.textContent = `Đang dịch: 0 / 0`;
    progressPercent.textContent = `0%`;
}

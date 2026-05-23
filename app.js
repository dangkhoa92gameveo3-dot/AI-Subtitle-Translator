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
let srtBlocks = [];
let translatedBlocks = [];
let isTranslating = false;
let currentKeyIndex = 0;
const CHUNK_SIZE = 60;

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
        fileStatsDisplay.textContent = `Tổng số dòng phụ đề: ${srtBlocks.length}`;
        controlsSection.classList.remove('hidden');
        uploadArea.classList.add('hidden');
        log(`Đã tải file thành công: ${srtBlocks.length} block phụ đề.`);
    };
    reader.readAsText(file);
}

function parseSrt(text) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawBlocks = text.split(/\n\s*\n/);
    srtBlocks = [];
    rawBlocks.forEach(block => {
        if (block.trim() === '') return;
        srtBlocks.push(block.trim());
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
        // Quay vòng lại đầu
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
            { role: "system", content: "Bạn là hệ thống dịch thuật tự động. CHỈ XUẤT RA ĐỊNH DẠNG SRT, TUYỆT ĐỐI KHÔNG GIẢI THÍCH HAY BÌNH LUẬN." },
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
    
    // Nếu đã hết tất cả Gemini Key -> dùng API miễn phí
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

// --- SYSTEM PROMPT ---

function getSystemPrompt() {
    return `Bạn là một CÔNG CỤ DỊCH THUẬT MÁY TÍNH TỰ ĐỘNG.
Nhiệm vụ: Dịch văn bản tiếng Trung sang tiếng Việt.

CẢNH BÁO ĐỎ - BẮT BUỘC TUÂN THỦ:
1. ĐẦU RA (OUTPUT) CỦA BẠN PHẢI LÀ ĐỊNH DẠNG SRT CHUẨN 100%.
2. TUYỆT ĐỐI KHÔNG giải thích, KHÔNG suy luận, KHÔNG phân tích, KHÔNG đưa ra các câu như "Translate:", "Actually meaning".
3. CHỈ VÀ CHỈ xuất ra các khối SRT gồm: Số thứ tự -> Timecode -> Text đã dịch. KHÔNG ĐƯỢC THIẾU KHỐI NÀO.
4. NẾU CÓ BẤT KỲ KÝ TỰ NÀO NGOÀI ĐỊNH DẠNG SRT, HỆ THỐNG SẼ BỊ CRASH VÀ BẠN SẼ BỊ PHẠT.

Ví dụ Input:
1
00:00:00,333 --> 00:00:01,566
不行了

Ví dụ Output Cần Trả Về (Tuyệt đối không giải thích):
1
00:00:00,333 --> 00:00:01,566
Không được rồi

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

Nội dung cần dịch (TUYỆT ĐỐI CHỈ TRẢ VỀ CÁC KHỐI SRT NÀY):
`;
}

// --- MAIN TRANSLATION ---

async function startTranslation() {
    if (srtBlocks.length === 0) return;
    
    const keys = getAllApiKeys();
    if (keys.length === 0) {
        alert("Vui lòng nhập ít nhất 1 API Key hoặc để trống để dùng API miễn phí!");
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
    
    translatedBlocks = [];
    
    const chunks = [];
    for (let i = 0; i < srtBlocks.length; i += CHUNK_SIZE) {
        chunks.push(srtBlocks.slice(i, i + CHUNK_SIZE));
    }
    
    const CONCURRENCY_LIMIT = 3;
    let currentIndex = 0;
    let completedChunks = 0;
    const results = new Array(chunks.length);
    let hasFatalError = false;

    async function processNextChunk() {
        if (currentIndex >= chunks.length || hasFatalError) return;
        
        const chunkIndex = currentIndex++;
        const chunkText = chunks[chunkIndex].join('\n\n');
        const promptText = getSystemPrompt() + "\n" + chunkText;
        let attempts = 0;
        let success = false;
        
        while (!success && attempts < 3 && !hasFatalError) {
            try {
                log(`Đang xử lý block ${chunkIndex * CHUNK_SIZE + 1} đến ${Math.min((chunkIndex + 1) * CHUNK_SIZE, srtBlocks.length)}...`);
                
                const result = await callTranslationApi(promptText);
                results[chunkIndex] = result;
                success = true;
                completedChunks++;
                
                const percent = Math.round((completedChunks / chunks.length) * 100);
                progressText.textContent = `Đang dịch: ${completedChunks} / ${chunks.length} phần`;
                progressPercent.textContent = `${percent}%`;
                progressBar.style.width = `${percent}%`;
                
            } catch (error) {
                attempts++;
                log(`Lỗi khi dịch phần ${chunkIndex+1}: ${error.message}`, true);
                if (attempts >= 3) {
                    log(`Đã thử 3 lần phần ${chunkIndex+1} nhưng thất bại. Tiến trình bị dừng.`, true);
                    hasFatalError = true;
                    return;
                }
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        await processNextChunk();
    }

    log(`Bắt đầu dịch siêu tốc (${chunks.length} phần, ${CONCURRENCY_LIMIT} luồng song song, ${keys.length} API Key)...`);
    
    const workers = [];
    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        workers.push(processNextChunk());
    }
    
    await Promise.all(workers);
    
    if (hasFatalError) {
        finishTranslation(false);
    } else {
        translatedBlocks = results;
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

function createDownload() {
    const finalSrtText = translatedBlocks.join('\n\n');
    const blob = new Blob([finalSrtText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const originalName = currentFile.name;
    const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.'));
    const newName = `${nameWithoutExt}_vi.srt`;
    
    downloadLink.href = url;
    downloadLink.download = newName;
}

function resetApp() {
    currentFile = null;
    srtBlocks = [];
    translatedBlocks = [];
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

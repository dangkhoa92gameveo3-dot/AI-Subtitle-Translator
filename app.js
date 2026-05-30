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
const useOllamaBtn = document.getElementById('useOllamaBtn');
const ollamaModelInput = document.getElementById('ollamaModelInput');

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
    localStorage.setItem('use_ollama', useOllamaBtn.checked);
    localStorage.setItem('ollama_model', ollamaModelInput.value.trim());
}

function loadSettings() {
    // Load Ollama settings
    const savedOllama = localStorage.getItem('use_ollama');
    if (savedOllama !== null) useOllamaBtn.checked = savedOllama === 'true';
    const savedModel = localStorage.getItem('ollama_model');
    if (savedModel !== null) ollamaModelInput.value = savedModel;
    
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

useOllamaBtn.addEventListener('change', saveSettings);
ollamaModelInput.addEventListener('input', saveSettings);

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

// --- OLLAMA LOCAL API ---
async function callOllamaApi(promptText) {
    const modelName = ollamaModelInput.value.trim() || "qwen3:4b";
    const payload = {
        model: modelName,
        system: "Bạn là biên dịch phụ đề phim Trung Quốc cổ trang, cung đấu, huyền huyễn, tu tiên. Hãy dịch sát nghĩa, thoát ý tự nhiên theo ngữ cảnh phim. Dịch đúng âm Hán Việt cho tên nhân vật và địa danh. Giữ nguyên thẻ [số] đầu dòng. KHÔNG thêm bớt dòng, KHÔNG giải thích.",
        prompt: promptText,
        stream: false,
        options: {
            temperature: 0.1
        }
    };
    
    // Đặt timeout 15 phút (900000ms) để tránh kẹt vĩnh viễn nếu máy yếu
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 900000); 

    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}. Kiểm tra lại Ollama đã bật chưa và có tải model '${modelName}' chưa?`);
        }
        
        const data = await response.json();
        return data.response.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '').trim();
    } catch (err) {
        if (err.name === 'AbortError') throw new Error(`Ollama phản hồi quá lâu (Timeout).`);
        throw new Error(`Không kết nối được Ollama. Lỗi: ${err.message}`);
    }
}

// --- MAIN API CALLER ---
async function callTranslationApi(promptText, retries = 15) {
    if (useOllamaBtn.checked) {
        try {
            return await callOllamaApi(promptText);
        } catch (error) {
            if (retries > 0) {
                log(`Lỗi Ollama: ${error.message} - Thử lại sau 2s...`, true);
                await new Promise(r => setTimeout(r, 2000));
                return callTranslationApi(promptText, retries - 1);
            }
            throw error;
        }
    }

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
    return `Bạn là biên dịch phụ đề phim Trung Quốc cổ trang, cung đấu, huyền huyễn, tu tiên với 10 năm kinh nghiệm.
Nhiệm vụ: dịch phụ đề tiếng Trung sang tiếng Việt tự nhiên, đúng ngữ cảnh, đúng vai vế, đúng thuật ngữ, giữ nguyên toàn bộ thẻ chỉ số kỹ thuật [số].

1. NGUYÊN TẮC BẮT BUỘC VỀ ĐỊNH DẠNG ĐẦU VÀO/ĐẦU RA
- Input gồm nhiều dòng thoại độc lập, mỗi dòng bắt đầu bằng thẻ chỉ số đặt trong ngoặc vuông [số] (Ví dụ: [1] 不行了).
- Output phải giữ nguyên thẻ [số] ở đầu dòng và chỉ thay thế phần text tiếng Trung bằng bản dịch tiếng Việt tương ứng.
- KHÔNG giải thích, KHÔNG ghi chú, KHÔNG bình luận thêm bên ngoài.
- KHÔNG tự ý thêm dòng mới, KHÔNG xóa dòng, KHÔNG gộp dòng hay thay đổi thứ tự thẻ [số].
- Số dòng output đầu ra PHẢI BẰNG ĐÚNG số dòng input đầu vào.
- Nếu trong dòng thoại gốc có các tag định dạng như <i>, </i>, {...}, [...], phải giữ nguyên vị trí hợp lý trong câu dịch.

2. QUY TRÌNH DỊCH THEO NGỮ CẢNH
- Trước khi dịch từng dòng, hãy đọc toàn bộ danh sách các dòng trong phân đoạn được cung cấp (chunk) để hiểu:
  + Ai đang nói với ai, quan hệ giữa các nhân vật (bối cảnh cung đình, tu tiên, gia tộc, môn phái).
  + Sắc thái cảm xúc của câu thoại (đe dọa, mỉa mai, cung kính, tức giận, đau khổ, ra lệnh, cầu xin).
- KHÔNG dịch từng câu rời rạc, KHÔNG dịch word-by-word máy móc.
- Phải dịch thoát ý và tự nhiên như lời thoại phim cổ trang Trung Quốc đã được Việt hóa.

3. QUY TẮC XƯNG HÔ CỔ TRANG
Xác định vai vế giao tiếp và giữ nhất quán trong suốt phân đoạn:
- Sư phụ - Đệ tử:
  + 师尊 / 师父 -> Sư tôn / Sư phụ.
  + Đệ tử xưng: đệ tử / con. Sư phụ gọi đệ tử: con / ngươi / đồ nhi tùy ngữ cảnh.
- Vua chúa - Thần tử:
  + 皇上 / 陛下 -> Hoàng thượng / Bệ hạ.
  + Vua xưng: trẫm. Thần tử xưng: thần / vi thần.
- Phi tần - Cung nữ / Thái giám:
  + 本宫 -> bản cung; 奴婢 -> nô tì; 奴才 -> nô tài; 娘娘 -> nương nương.
  + Phi tần gọi người dưới: ngươi. Người dưới gọi phi tần: nương nương / người.
- Tu sĩ / Cao nhân:
  + 本座 -> bản tọa; 老夫 -> lão phu; 前辈 -> tiền bối; 小辈 -> tiểu bối.
  + Tôn xưng cao nhân: ngài / tiền bối.
- Huynh muội / Bằng hữu / Đồng môn:
  + 哥哥 -> ca ca; 妹妹 -> muội muội; 兄长 -> huynh trưởng; 师兄 -> sư huynh; 师姐 -> sư tỷ; 师弟 -> sư đệ; 师妹 -> sư muội.
  + Đồng vai vế dùng: ta - ngươi / huynh - muội / ta - huynh tùy quan hệ thân sơ.
- Kẻ thù / Khinh miệt:
  + Dùng: ta - ngươi, bổn tọa - ngươi, bản cung - ngươi.
- KHÔNG dùng xưng hô hiện đại như: tôi, bạn, anh, chị, cô, chú, bác (trừ khi cực kỳ phù hợp).
- Nếu chưa chắc chắn quan hệ bối cảnh, ưu tiên cách xưng trung tính cổ trang: ta - ngươi.

4. TÊN RIÊNG VÀ THUẬT NGỮ HÁN VIỆT
Tất cả tên nhân vật, địa danh, môn phái, gia tộc, pháp bảo, vũ khí, chiêu thức, cảnh giới, linh thú, bí cảnh, đan dược phải được chuyển sang âm Hán Việt chuẩn. KHÔNG dịch nghĩa đen của tên riêng.
Ví dụ:
- 萧炎 -> Tiêu Viêm
- 玄铁 -> Huyền Thiết
- 天雷斩 -> Thiên Lôi Trảm
- 火龙术 -> Hỏa Long Thuật
Khi một tên riêng mới xuất hiện: tự phiên âm Hán Việt chuẩn nhất và dùng nhất quán tên đó cho đến hết file dịch. Nếu phụ đề gốc bị nhận diện sai thành nhiều từ đồng âm gần giống nhau, phải chủ động quy về cùng một tên nhân vật hợp lý.

5. TỪ ĐIỂN CỐ ĐỊNH (LUÔN ƯU TIÊN)
- 慕容婉歌 / 慕容婉言 / 慕容宛哥 / 慕容碗哥 / 慕容晚年 / 墨晚哥 -> Mộ Dung Uyển Ca
- 许金龙 -> Hứa Kim Long
- 黑虎 -> Hắc Hổ
- 玄铁龟 -> Huyền Thiết Quy
- 龙族女帝 -> Nữ Đế Long Tộc
- 龙血果 -> Long Huyết Quả
- 灵潭 -> linh đàm
- 妖丹 / 腰单 / 腰单 -> yêu đan
- 妖兽 -> yêu thú
- 系统 -> hệ thống
- 宿主 -> túc chủ
- 本宫 -> bản cung
- 本座 -> bản tọa
- 纷纷 / 芬芬 -> Phân Phân

6. THUẬT NGỮ TU TIÊN / HUYỀN HUYỄN THƯỜNG GẶP
Giữ âm Hán Việt quen thuộc, không diễn giải dài dòng:
- 炼气 -> luyện khí; 筑基 -> trúc cơ; 结丹 -> kết đan; 金丹 -> kim đan; 元婴 -> nguyên anh; 化神 -> hóa thần; 渡劫 -> độ kiếp; 飞升 -> phi thăng.
- 灵力 -> linh lực; 灵气 -> linh khí; 丹田 -> đan điền; 经脉 -> kinh mạch; 神识 -> thần thức.
- 法宝 -> pháp bảo; 灵兽 -> linh thú; 妖兽 -> yêu thú; 妖丹 -> yêu đan; 秘境 -> bí cảnh; 宗门 -> tông môn; 长老 -> trưởng lão; 掌门 -> chưởng môn.

7. SỬA LỖI ASR (NHẬN DIỆN GIỌNG NÓI PHỤ ĐỀ TRUNG QUỐC)
Dựa vào ngữ cảnh để tự sửa lỗi trước khi dịch:
- 腰单 / 腰单 -> 妖丹 -> yêu đan.
- 划龙术 -> 火龙术 -> Hỏa Long Thuật.
- 纷纷 / 芬芬 (nếu là tên người) -> Phân Phân.
- Đồng âm sai trong bối cảnh tu tiên phải tự quy về thuật ngữ tu tiên hợp lý, không dịch máy móc lỗi ASR thành nghĩa thuần Việt ngớ ngẩn.

8. VĂN PHONG DỊCH
- Tự nhiên, ngắn gọn, dễ đọc, mang sắc thái cổ trang kiếm hiệp, giữ được cảm xúc của nhân vật.
- Ưu tiên câu thoại ngắn, rõ ràng, hợp nhịp phụ đề.
Ví dụ phong cách:
- "Ngươi dám phản bội bản cung?"
- "Sư tôn, đệ tử biết sai rồi."
- "Chỉ bằng ngươi mà cũng muốn cản bản tọa?"
- "Long Huyết Quả này, ta nhất định phải lấy được."

9. XỬ LÝ CÂU THOẠI NGẮN / MƠ HỒ
Dịch linh hoạt theo cảm xúc và ngữ cảnh thay vị khô cứng:
- 什么 -> Cái gì? / Sao cơ?
- 不可能 -> Không thể nào!
- 你敢 -> Ngươi dám!
- 住手 -> Dừng tay!
- 放肆 -> To gan!
- 该死 -> Chết tiệt! / Đáng chết!

Dịch các dòng sau:
`;
}

// ============================================================
// MAIN TRANSLATION
// ============================================================
async function startTranslation() {
    if (parsedSubtitles.length === 0) return;
    const keys = getAllApiKeys();
    if (!useOllamaBtn.checked && keys.length === 0) { 
        alert("Vui lòng nhập ít nhất 1 API Key hoặc bật Dùng AI Nội Bộ (Ollama)!"); 
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
    const currentChunkSize = useOllamaBtn.checked ? 10 : CHUNK_SIZE; // Dùng 10 dòng/chunk cho Ollama để máy không bị treo
    
    for (let i = 0; i < parsedSubtitles.length; i += currentChunkSize) {
        chunks.push({ startIdx: i, endIdx: Math.min(i + currentChunkSize, parsedSubtitles.length) });
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

    // Gemini: 3 luồng | Ollama: 1 luồng
    const concurrency = useOllamaBtn.checked ? 1 : 3;
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

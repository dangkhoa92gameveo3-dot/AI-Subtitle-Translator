# AI Subtitle Translator

Ứng dụng Web dịch phụ đề `.srt` từ tiếng Trung sang tiếng Việt sử dụng **Gemini AI** với khả năng luân phiên API Key tự động.

## Tính năng

- 🎯 **Dịch chính xác**: Sử dụng Gemini AI với prompt chuyên biệt cho dịch phim
- ⚡ **Siêu tốc**: Xử lý song song 3 luồng cùng lúc
- 🔄 **Luân phiên API Key**: Thêm bao nhiêu Key tùy thích, hệ thống tự động đổi khi gặp lỗi
- 🆓 **API miễn phí dự phòng**: Tự động chuyển sang AI miễn phí khi hết quota
- 📦 **Không cần cài đặt**: Mở file `index.html` trên trình duyệt là dùng được ngay
- 🎨 **Giao diện cao cấp**: Dark mode, Glassmorphism, hiệu ứng mượt mà

## Cách sử dụng

1. Mở file `index.html` bằng trình duyệt (Chrome/Edge)
2. Kéo thả file `.srt` vào ô upload
3. Nhập API Key Gemini (có thể thêm nhiều Key)
4. Nhấn **Bắt Đầu Dịch**
5. Tải file kết quả về

## Lấy API Key Gemini miễn phí

1. Truy cập [Google AI Studio](https://aistudio.google.com/apikey)
2. Nhấn **Create API Key**
3. Copy và dán vào ứng dụng

## Quy tắc dịch thuật

- Giữ nguyên tuyệt đối số thứ tự và timecode
- Đồng nhất tên nhân vật theo từ điển tùy chỉnh
- Không gộp/tách dòng, giữ nguyên cấu trúc SRT

import { useState } from "react";
// Import component ChatBot của anh/chị vào đây
import ChatBot from "../AIchatbot/ChatBot";
import "./FileViewer.css"; // Anh/chị tự tạo file CSS cho phần này nhé

function FileViewer({ documentUrl, documentName, documentId }) {
  const [isChatOpen, setIsChatOpen] = useState(false);

  return (
    <div className="file_viewer_container" style={{ display: "flex", height: "100vh", backgroundColor: "var(--bg-primary)" }}>

      {/* CỘT TRÁI: Khu vực xem file trực tiếp */}
      <div className="file_preview_section" style={{ flex: 1, padding: "20px", display: "flex", flexDirection: "column" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
          <h2 style={{ margin: 0, fontSize: "1.2rem", color: "var(--text-primary)" }}>{documentName}</h2>

          {/* Nút gọi AI Chatbot chỉ hiển thị khi khung chat đang đóng */}
          {!isChatOpen && (
            <button
              onClick={() => setIsChatOpen(true)}
              style={{
                padding: "8px 16px", backgroundColor: "var(--button-bg)", color: "var(--button-text)",
                border: "none", borderRadius: "6px", cursor: "pointer", display: "flex", gap: "8px"
              }}
            >
              <i className="ti-comments"></i> Hỏi AI về file này
            </button>
          )}
        </header>

        {/* Nhúng thẳng URL file (PDF/Ảnh) vào iframe để xem không cần tải */}
        <div style={{ flex: 1, backgroundColor: "var(--bg-card)", borderRadius: "8px", overflow: "hidden", boxShadow: "var(--shadow-soft)" }}>
          <iframe
            src={documentUrl}
            title={documentName}
            width="100%"
            height="100%"
            style={{ border: "none" }}
          />
        </div>
      </div>

      {/* CỘT PHẢI: Khung AI Chatbot (Chỉ render và tốn token khi người dùng bấm mở) */}
      {isChatOpen && (
        <div className="chatbot_sidebar_section" style={{ width: "400px", backgroundColor: "var(--bg-card)", borderLeft: "1px solid var(--border-color)", display: "flex", flexDirection: "column" }}>
          <header style={{ padding: "15px", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>
              <i className="ti-wand" style={{ marginRight: "8px", color: "var(--accent-color)" }}></i>
              AI Assistant
            </h3>
            <button
              onClick={() => setIsChatOpen(false)}
              style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "var(--text-muted)" }}
            >
              ×
            </button>
          </header>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {/* Truyền documentId vào để Chatbot biết lấy context từ file nào */}
            <ChatBot documentId={documentId} />
          </div>
        </div>
      )}
    </div>
  );
}

export default FileViewer;

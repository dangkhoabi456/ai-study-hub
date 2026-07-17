import { useEffect, useRef, useState } from "react";
import "./ChatBot.css";
import aiChatbotIcon from "../../../assets/imgs/iconchatbot.svg";

import { IoIosSend } from "react-icons/io";
import { RiResetRightLine } from "react-icons/ri";
import { IoMdClose } from "react-icons/io";
import { IoChatbubbleEllipses } from "react-icons/io5";

import { FaHistory } from "react-icons/fa";
import { RiRobot2Fill } from "react-icons/ri";
import { FaUser } from "react-icons/fa6";

function ChatBot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const [loading, setLoading] = useState(false);

  const [documents, setDocuments] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");

  const bottomRef = useRef(null);

  const [messages, setMessages] = useState([
    {
      id: 1,
      role: "ai",
      text: "Hello 👋 Select an approved document and ask me something.",
    },
  ]);

  const [history, setHistory] = useState([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    async function loadApprovedDocuments() {
      try {
        const token = localStorage.getItem("accessToken");

        const response = await fetch("http://localhost:5000/api/documents", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message || "Could not load documents.");
        }

        const approvedDocs = (result.data || []).filter(
          (doc) => doc.status === "APPROVED",
        );

        setDocuments(approvedDocs);

        if (approvedDocs.length > 0) {
          setSelectedDocumentId(approvedDocs[0].id);
        }
      } catch (error) {
        console.error("Could not load approved documents:", error);
      }
    }

    if (open) {
      loadApprovedDocuments();
    }
  }, [open]);

  const sendMessage = async () => {
    if (input.trim() === "" || loading) return;

    if (!selectedDocumentId) {
      const aiMessage = {
        id: Date.now(),
        role: "ai",
        text: "Please upload and select an approved document first.",
      };

      setMessages((prev) => [...prev, aiMessage]);
      return;
    }

    const currentInput = input.trim();

    const userMessage = {
      id: Date.now(),
      role: "user",
      text: currentInput,
    };

    setMessages((prev) => [...prev, userMessage]);
    setHistory((prev) => [...prev, userMessage]);

    setInput("");

    setLoading(true);

    try {
      const token = localStorage.getItem("accessToken");

      const response = await fetch("http://localhost:5000/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          documentId: selectedDocumentId,
          question: currentInput,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "AI request failed.");
      }

      const aiMessage = {
        id: Date.now() + 1,
        role: "ai",
        text: result.data.answer,
      };

      setMessages((prev) => [...prev, aiMessage]);
      setHistory((prev) => [...prev, aiMessage]);
    } catch (error) {
      const aiMessage = {
        id: Date.now() + 1,
        role: "ai",
        text: error.message || "Sorry, I could not answer using this document.",
      };

      setMessages((prev) => [...prev, aiMessage]);
      setHistory((prev) => [...prev, aiMessage]);
    } finally {
      setLoading(false);
    }
  };

  const resetChat = () => {
    setMessages([
      {
        id: 1,
        role: "ai",
        text: "Hello 👋 Select an approved document and ask me something.",
      },
    ]);
  };

  return (
    <div>
      <div id="bubble">
        <button onClick={() => setOpen(!open)}>
          <IoChatbubbleEllipses />
        </button>
      </div>

      {open && (
        <div className="chat-box">
          <div className="chat-header">
            <img src={aiChatbotIcon} alt="AI Chatbot" />

            <div className="header-actions">
              <button onClick={() => setShowHistory(!showHistory)}>
                <FaHistory />
              </button>

              <button onClick={resetChat}>
                <RiResetRightLine />
              </button>

              <button onClick={() => setOpen(false)}>
                <IoMdClose />
              </button>
            </div>
          </div>

          <div className="document-select-container">
            <select
              value={selectedDocumentId}
              onChange={(e) => setSelectedDocumentId(e.target.value)}
              className="document-select"
              disabled={loading}
            >
              {documents.length === 0 && (
                <option value="">No approved documents available</option>
              )}

              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
            </select>
          </div>
          {showHistory && (
            <div className="chat-history">
              <h4>Chat History</h4>
              {history.map((m) => (
                <div key={m.id}>
                  <b>{m.role}</b>: {m.text}
                </div>
              ))}
            </div>
          )}

          <div className="chat-body">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`msg-row ${
                  m.role === "user" ? "user-row" : "ai-row"
                }`}
              >
                <div className="avatar">
                  {m.role === "user" ? <FaUser /> : <RiRobot2Fill />}
                </div>

                <div
                  className={`message ${
                    m.role === "user" ? "user-msg" : "ai-msg"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {loading && (
              <div id="load-msg">
                <b>StudyHub Assistant</b> is thinking...
              </div>
            )}

            <div ref={bottomRef}></div>
          </div>

          <div className="chat-input">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask something about the selected document..."
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />

            <button onClick={sendMessage} disabled={loading}>
              <IoIosSend />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatBot;

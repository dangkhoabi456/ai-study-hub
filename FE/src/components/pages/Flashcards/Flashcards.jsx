import { useEffect, useState } from "react";
import "./Flashcards.css";

function Flashcards() {
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [flashcards, setFlashcards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadDocuments() {
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
        (doc) => doc.status === "APPROVED"
      );

      setDocuments(approvedDocs);

      if (approvedDocs.length > 0) {
        setSelectedDocumentId(approvedDocs[0].id);
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  useEffect(() => {
    const loadTimer = window.setTimeout(loadDocuments, 0);
    return () => window.clearTimeout(loadTimer);
  }, []);

  async function generateFlashcards() {
    if (!selectedDocumentId || loading) return;

    setLoading(true);
    setMessage("");
    setFlashcards([]);

    try {
      const token = localStorage.getItem("accessToken");

      const response = await fetch(
        `http://localhost:5000/api/ai/documents/${selectedDocumentId}/flashcards`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Could not generate flashcards.");
      }

      setFlashcards(result.data || []);
      setMessage("Flashcards generated successfully.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flashcards-page">
      <div className="flashcards-header">
        <div>
          <h1>AI Flashcards</h1>
          <p>Generate study cards from your approved learning documents.</p>
        </div>
      </div>

      <div className="flashcards-card">
        <div className="flashcards-toolbar">
          <div className="flashcards-field">
            <label>Approved document</label>
            <select
              value={selectedDocumentId}
              onChange={(e) => setSelectedDocumentId(e.target.value)}
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

          <button
            className="flashcards-primary-btn"
            onClick={generateFlashcards}
            disabled={loading || !selectedDocumentId}
          >
            {loading ? "Generating..." : "Generate Flashcards"}
          </button>
        </div>

        {message && <div className="flashcards-message">{message}</div>}

        <div className="flashcards-grid">
          {flashcards.map((card, index) => (
            <div className="flashcard-item" key={card.id || index}>
              <div className="flashcard-index">Card {index + 1}</div>

              <div className="flashcard-section">
                <span>Question</span>
                <p>{card.question}</p>
              </div>

              <div className="flashcard-section">
                <span>Answer</span>
                <p>{card.answer}</p>
              </div>
            </div>
          ))}
        </div>

        {!loading && flashcards.length === 0 && (
          <div className="flashcards-empty">
            Select a document and generate flashcards to start reviewing.
          </div>
        )}
      </div>
    </div>
  );
}

export default Flashcards;

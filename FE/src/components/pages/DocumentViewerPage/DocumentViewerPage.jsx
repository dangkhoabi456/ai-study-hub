import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getDocumentView } from "../../../utils/documentApi";
import { getStoredUser } from "../../../utils/authToken";
import FileViewer from "../FileViewer/FileViewer";
import "./DocumentViewerPage.css";

const PENDING_DOCUMENT_CHAT_KEY = "aiStudyHubPendingDocumentChat";

const QUICK_PROMPTS = [
  {
    label: "Summary",
    icon: "ti-write",
    prompt: "Summarize the key points in this document.",
  },
  {
    label: "Generate Flashcards",
    icon: "ti-layers",
    action: "flashcards",
  },
];

function formatDisplayFileName(fileName) {
  return String(fileName || "Untitled document")
    .replace(/\.(pdf|docx|txt)$/i, "")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function DocumentViewerPage() {
  const { documentId } = useParams();
  const navigate = useNavigate();
  const [documentData, setDocumentData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [question, setQuestion] = useState("");
  const isGuest = getStoredUser()?.role === "GUEST";

  useEffect(() => {
    let isMounted = true;

    async function loadDocument() {
      try {
        setIsLoading(true);
        setErrorMessage("");

        const data = await getDocumentView(documentId);
        if (!isMounted) return;

        setDocumentData(data);
      } catch (error) {
        if (!isMounted) return;

        setErrorMessage(
          error.response?.data?.message || "Cannot open this document.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadDocument();

    return () => {
      isMounted = false;
    };
  }, [documentId]);

  if (isLoading) {
    return (
      <main className="document_viewer_state">
        <div>
          <i className="ti-reload document_viewer_spinner" />
          <h1>Opening document</h1>
          <p>Please wait while we prepare a secure viewing link.</p>
        </div>
      </main>
    );
  }

  if (errorMessage || !documentData?.viewUrl) {
    return (
      <main className="document_viewer_state">
        <div>
          <i className="ti-alert" />
          <h1>Document unavailable</h1>
          <p>{errorMessage || "The viewing link could not be created."}</p>
          <button type="button" onClick={() => navigate(-1)}>
            Back
          </button>
        </div>
      </main>
    );
  }

  function openDocumentChat(nextQuestion = question) {
    const trimmedQuestion = nextQuestion.trim();
    if (!trimmedQuestion) return;

    localStorage.setItem(
      PENDING_DOCUMENT_CHAT_KEY,
      JSON.stringify({
        id: `${documentData.documentId}-${Date.now()}`,
        documentId: documentData.documentId,
        documentTitle: formatDisplayFileName(documentData.fileName),
        question: trimmedQuestion,
        createdAt: new Date().toISOString(),
      }),
    );

    navigate("/dashboard/ai-chat");
  }

  function handleQuickAction(item) {
    if (item.action === "flashcards") {
      navigate(
        `/dashboard/flashcards?documentId=${encodeURIComponent(documentData.documentId)}`,
      );
      return;
    }

    openDocumentChat(item.prompt);
  }

  return (
    <>
      <FileViewer
        documentUrl={documentData.viewUrl}
        documentName={documentData.fileName}
        displayName={formatDisplayFileName(documentData.fileName)}
        documentId={documentData.documentId}
      />

      {!isGuest && (
        <section className="document_chat_assistant" aria-label="Document AI assistant">
          <div className="document_chat_quick_actions">
            {QUICK_PROMPTS.map((item) => (
              <button
                type="button"
                key={item.label}
                onClick={() => handleQuickAction(item)}
              >
                <i className={item.icon} />
                {item.label}
              </button>
            ))}
          </div>

          <form
            className="document_chat_input"
            onSubmit={(event) => {
              event.preventDefault();
              openDocumentChat();
            }}
          >
            <input
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a question about this document"
            />
            <button
              type="submit"
              disabled={question.trim() === ""}
              aria-label="Send question"
            >
              <i className="ti-arrow-right" />
            </button>
          </form>
        </section>
      )}
    </>
  );
}

export default DocumentViewerPage;

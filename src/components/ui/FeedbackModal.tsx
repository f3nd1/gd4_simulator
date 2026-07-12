import { useState } from "react";

type FeedbackModalProps = {
  open: boolean;
  aiOutput: string;
  onClose: () => void;
  onSubmit: (feedback: {
    thumbs: "up" | "down";
    correct: boolean;
    correction: string;
    reason: string;
  }) => void;
};

export function FeedbackModal({ open, aiOutput, onClose, onSubmit }: FeedbackModalProps) {
  const [correct, setCorrect] = useState(false);
  const [correction, setCorrection] = useState("");
  const [reason, setReason] = useState("");

  if (!open) return null;

  const preview = aiOutput.length > 200 ? aiOutput.slice(0, 200) + "…" : aiOutput;

  const canSubmit = correct || (correction.trim().length > 0 && reason.trim().length > 0);

  function handleSubmit() {
    onSubmit({ thumbs: "down", correct, correction: correct ? "" : correction, reason: correct ? "" : reason });
    onClose();
  }

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      onClick={handleBackdrop}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 12,
          maxWidth: 480,
          width: "100%",
          padding: 20,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Provide Feedback</h2>

        <div
          style={{
            backgroundColor: "#f3f4f6",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 13,
            color: "#374151",
            wordBreak: "break-word",
          }}
        >
          {preview}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 14 }}>Was the AI correct?</span>
          <div style={{ display: "flex", gap: 20 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14 }}>
              <input
                type="radio"
                name="correct"
                checked={correct}
                onChange={() => setCorrect(true)}
              />
              Yes
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14 }}>
              <input
                type="radio"
                name="correct"
                checked={!correct}
                onChange={() => setCorrect(false)}
              />
              No
            </label>
          </div>
        </div>

        {!correct && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontWeight: 500, fontSize: 14 }}>What is the correct answer?</label>
              <textarea
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  padding: "8px 10px",
                  fontSize: 13,
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontWeight: 500, fontSize: 14 }}>Why was the AI wrong?</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  padding: "8px 10px",
                  fontSize: 13,
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              backgroundColor: "#fff",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              backgroundColor: canSubmit ? "#2563eb" : "#93c5fd",
              color: "#fff",
              cursor: canSubmit ? "pointer" : "not-allowed",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Submit Feedback
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div style={{
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: 0,
      background: "var(--ink-0)",
    }}>
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        color: "var(--paper-3)",
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24"
          style={{ animation: "loading-spin 0.8s linear infinite" }}>
          <circle cx="12" cy="12" r="10" fill="none"
            stroke="var(--line)" strokeWidth="2" />
          <path d="M12 2 A10 10 0 0 1 22 12" fill="none"
            stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <style>{`@keyframes loading-spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );
}

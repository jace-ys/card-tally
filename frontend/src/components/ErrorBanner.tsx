export function ErrorBanner({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <strong>⚠️ Something went wrong:</strong>
      <span>{error.message}</span>
    </div>
  );
}

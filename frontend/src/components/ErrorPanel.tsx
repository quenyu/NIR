interface ErrorPanelProps {
  errors: string[];
}

export function ErrorPanel({ errors }: ErrorPanelProps) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <section className="panel error-panel" data-testid="error-panel">
      <h2>Ошибки проверки / моделирования</h2>
      <ul>
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </section>
  );
}

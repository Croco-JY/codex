import { errorView } from "../api/errors";
import { Button } from ".";
export function ApiErrorState({
  error,
  retry,
  title,
  page = false,
}: {
  error: unknown;
  retry?: () => void;
  title?: string;
  page?: boolean;
}) {
  const view = errorView(error);
  const Heading = page ? "h1" : "h2";
  return (
    <div className="error" role="alert">
      <Heading>{title ?? view.title}</Heading>
      <p>{view.message}</p>
      {view.requestId && (
        <p className="muted">
          Request reference: <code>{view.requestId}</code>
        </p>
      )}
      {retry && (
        <Button onClick={retry}>
          {view.retryable ? "Try again" : "Reload"}
        </Button>
      )}
    </div>
  );
}

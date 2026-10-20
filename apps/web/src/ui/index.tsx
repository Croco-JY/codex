import type { ComponentProps, ReactNode } from "react";
export function Button(props: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={`button ${props.className ?? ""}`}
    />
  );
}
export function Input(props: ComponentProps<"input">) {
  return <input {...props} className="input" />;
}
export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Surface({ children, ...props }: ComponentProps<"section">) {
  return (
    <section {...props} className="surface">
      {children}
    </section>
  );
}
export function PageLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="page" tabIndex={-1}>
      {children}
    </main>
  );
}
export function Stack({ children }: { children: ReactNode }) {
  return <div className="stack">{children}</div>;
}
export function Skeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {label}…
    </div>
  );
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error" role="alert">
      <p>{message}</p>
      {retry && <Button onClick={retry}>Try again</Button>}
    </div>
  );
}

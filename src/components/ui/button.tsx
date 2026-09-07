import { cn } from "@/lib/cn";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
};

export function Button({ loading = false, disabled, className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn("button", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      <span>{loading ? "جارٍ تسجيل الدخول" : children}</span>
    </button>
  );
}

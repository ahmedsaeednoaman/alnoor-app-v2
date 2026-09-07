import { cn } from "@/lib/cn";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
};

export function Input({ label, error, startAdornment, endAdornment, id, className, ...props }: InputProps) {
  const helpId = `${id}-error`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className="field__control">
        {startAdornment && <div className="field__start-adornment">{startAdornment}</div>}
        <input
          id={id}
          className={cn("input", error && "input--error", className)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? helpId : undefined}
          {...props}
        />
        {endAdornment && <div className="field__adornment">{endAdornment}</div>}
      </div>
      {error && <p className="field__error" id={helpId}>{error}</p>}
    </div>
  );
}

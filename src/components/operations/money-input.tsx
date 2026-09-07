"use client";

type MoneyInputProps = {
  value: string | number | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  allowNegative?: boolean;
  ariaLabel?: string;
};

export function normalizeMoneyInput(rawValue: string, allowNegative = false) {
  void allowNegative;
  const negative = /^\s*-/.test(rawValue);
  const raw = rawValue.replace(/[^0-9.]/g, "");
  const [integer = "", ...decimalParts] = raw.split(".");
  const decimal = decimalParts.join("").slice(0, 2);
  const result = decimalParts.length ? `${integer}.${decimal}` : integer;
  return negative && result ? `-${result}` : result;
}

export function MoneyInput({ value, onChange, disabled = false, placeholder, className = "", allowNegative = false, ariaLabel }: MoneyInputProps) {
  const text = value == null ? "" : String(value);
  return <span className={`money-field${disabled ? " is-disabled" : ""}`}>
    <input
      className={`money-input ${className}`}
      dir="ltr"
      inputMode="decimal"
      type="text"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoComplete="off"
      onWheel={(event) => event.currentTarget.blur()}
      onChange={(event) => {
        onChange(normalizeMoneyInput(event.target.value, allowNegative));
      }}
    />
    <span className="money-field__currency" aria-hidden="true">ج.م</span>
  </span>;
}

import Image from "next/image";

type BrandLogoProps = {
  variant?: "mark" | "stacked" | "horizontal";
  tone?: "default" | "onDark" | "mono";
  size?: "sm" | "md" | "lg";
  animated?: boolean;
  className?: string;
};

export function BrandLogo({
  variant = "stacked",
  size = "md",
  animated = false,
  className = "",
}: BrandLogoProps) {
  return (
    <div
      className={[
        "brand-logo",
        `brand-logo--${variant}`,
        `brand-logo--${size}`,
        animated ? "brand-logo--animated" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="النور للمناظير الطبية"
    >
      <div className="brand-logo__official">
        <Image
          src="/images/Al-Noor Endoscope Medical Logo.png"
          alt="النور للمناظير الطبية"
          width={1200}
          height={760}
          priority
          className="brand-logo__official-image"
        />
      </div>

      {variant !== "mark" && (
        <div className="brand-logo__copy">
          <div className="brand-logo__subtitle">
            للمناظير الطبية
          </div>

          <div className="brand-logo__english">
            <i aria-hidden="true" />
            <span>ALNOOR MEDICAL OPERATIONS</span>
            <i aria-hidden="true" />
          </div>
        </div>
      )}
    </div>
  );
}
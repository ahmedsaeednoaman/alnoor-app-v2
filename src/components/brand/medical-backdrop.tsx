import Image from "next/image";

export function MedicalBackdrop() {
  return (
    <div className="medical-backdrop" aria-hidden="true">
      <Image className="medical-backdrop__image" src="/images/alnoor-endoscopy-scene.png" alt="" fill priority quality={90} sizes="100vw" />
      <div className="medical-backdrop__wash" />
      <svg className="medical-backdrop__optics" viewBox="0 0 600 600">
        <circle cx="300" cy="300" r="218"/><circle cx="300" cy="300" r="176"/><circle cx="300" cy="300" r="122"/>
        <path d="M72 286c84-122 184-187 300-195"/><path d="M520 368c-88 88-184 132-291 132"/>
      </svg>
      <div className="medical-backdrop__flare" />
      <span className="particle particle--one"/><span className="particle particle--two"/><span className="particle particle--three"/><span className="particle particle--four"/>
    </div>
  );
}

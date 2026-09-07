export function AppFooter() {
  return (
    <footer className="app-footer">
      <div className="app-footer__copyright">
        <span>
          © {new Date().getFullYear()}
        </span>

        <strong>
          النور للمناظير الطبية
        </strong>

        <span>
          جميع الحقوق محفوظة
        </span>
      </div>

      <div className="app-footer__state">
        <span
          className="app-footer__state-dot"
          aria-hidden="true"
        />

        <span>
          النظام يعمل بصورة طبيعية
        </span>
      </div>
    </footer>
  );
}
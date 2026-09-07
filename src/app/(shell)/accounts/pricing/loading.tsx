export default function PricingHubLoading() {
  return <main className="pricing-hub" dir="rtl" aria-busy="true">
    <header className="pricing-hub__hero"><div><span className="pricing-hub__eyebrow">مركز إدارة التسعير</span><h1>بنود وأسعار</h1><p>جارٍ تحميل مجالات التسعير المتاحة...</p></div></header>
    <section className="pricing-hub__grid" aria-label="جارٍ تحميل مجالات إدارة الأسعار">
      {[0, 1, 2].map((index) => <div className="pricing-domain-card pricing-domain-card--loading" key={index}><span /><span /><span /></div>)}
    </section>
  </main>;
}

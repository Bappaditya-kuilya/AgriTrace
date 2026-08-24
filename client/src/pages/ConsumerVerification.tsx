/** Field Operations Console: public dossier backed by the persisted, hash-verified demo batch. */
import { ArrowLeft, BadgeCheck, Check, CircleCheck, MapPin, ShieldCheck, TriangleAlert } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useLocation, useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { BRAND } from "@/lib/brand";

const titleFor = (type: string) => ({ harvest: "Harvest", collection: "Collection received", quality_inspection: "Quality inspection", trader_offer: "Trader purchase", transit: "Transit evidence", warehouse_receipt: "Warehouse receipt", retail_receipt: "Retail receipt" }[type] ?? "Recorded event");
const formatDate = (value: Date) => new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
const eventValue = (event: { quantityKg: string | null; pricePerKg: string | null; qualityGrade: string | null; transitHours: string | null }) => {
  if (event.pricePerKg) return `₹${event.pricePerKg}/kg`;
  if (event.quantityKg) return `${event.quantityKg} kg`;
  if (event.transitHours) return `${event.transitHours}h transit`;
  return event.qualityGrade ?? "Recorded";
};

export default function ConsumerVerification() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/verify/:batchCode");
  const batchCode = params?.batchCode;
  const record = trpc.batch.publicDetail.useQuery({ batchCode: batchCode ?? "" }, { enabled: Boolean(batchCode) });
  if (!batchCode) return <VerificationState label="A batch verification code is required." />;
  if (record.isLoading) return <VerificationState label="Loading verified batch record…" />;
  if (record.isError) return <VerificationState label="No public batch record matches this verification code." />;
  if (!record.data) return <VerificationState label="The batch record is temporarily unavailable." />;

  const { batch, events, anomalies } = record.data;
  const priceFinding = anomalies.find((finding) => finding.category === "price");
  const transitFinding = anomalies.find((finding) => finding.category === "logistics" || finding.category === "quality");
  const harvest = events.find((event) => event.eventType === "harvest");
  const integrityText = `${events.length}/${events.length} critical events recorded`;
  const traceStatus = anomalies.length ? "Review signals are recorded" : "No review signals are recorded";

  return <div className="verify-app">
    <header className="verify-header"><div className="verify-header-inner"><button onClick={() => setLocation("/")} className="verify-back"><ArrowLeft size={16} /> Operations console</button><div className="verify-brand"><span className="verify-brand-mark" aria-hidden="true" /><span><b>Agri</b><strong>Trace</strong><small>INTELLIGENCE</small></span></div></div></header>
    <main className="verify-main">
      <section className="verify-banner"><div className="verify-banner-copy"><span className="verify-chip"><BadgeCheck size={15} /> Prototype record verified</span><p className="ops-eyebrow">Public batch record</p><h1>{batch.crop}{batch.grade ? `, ${batch.grade}` : ""}</h1><p>Trace the persisted batch record from its farm origin to the latest recorded supply-chain event. Private producer and payment details remain protected.</p><div className="verify-meta"><span><MapPin size={15} /> {batch.originDistrict}, {batch.originState}</span><span><ShieldCheck size={15} /> {integrityText}</span></div></div><div className="verify-qr"><QRCodeSVG value={`${window.location.origin}/verify/${batch.batchCode}`} size={134} fgColor={BRAND.ink} /><small>QR entry point</small></div></section>
      <section className="verify-record" aria-label="How to read this trace record"><div className="verify-section-head"><div><p className="ops-eyebrow">Trace status</p><h2>{traceStatus}</h2></div><span className={`state-pill ${anomalies.length ? "state-review" : "state-verified"}`}>{anomalies.length ? "Review record" : "Recorded clear"}</span></div><div className="verify-facts"><div><span>What you can check</span><strong>Origin, recorded journey, quality and review signals</strong></div><div><span>What stays private</span><strong>Personal contact details, internal payments and staff identities</strong></div><div><span>What this does not prove</span><strong>Food safety, physical condition, or every real-world input</strong></div></div></section>
      <div className="verify-layout"><section className="verify-record"><div className="verify-section-head"><div><p className="ops-eyebrow">Batch identity</p><h2>{batch.batchCode}</h2></div><span className="state-pill state-verified"><Check size={13} /> Recorded</span></div><div className="verify-facts"><div><span>Origin</span><strong>{batch.originDistrict}, {batch.originState}</strong></div><div><span>Harvest date</span><strong>{harvest ? formatDate(harvest.occurredAt) : "—"}</strong></div><div><span>Record status</span><strong>{batch.status.replaceAll("_", " ")}</strong></div></div></section>
        <section className="verify-record verify-journey"><div className="verify-section-head"><div><p className="ops-eyebrow">Supply-chain journey</p><h2>Recorded activity</h2></div><span className="verify-count">{events.length} recorded events</span></div><ol>{events.map((event, index) => { const hasRisk = anomalies.some((finding) => finding.batchEventId === event.id); return <li key={event.eventCode}><span className={`verify-step ${hasRisk ? "verify-step-review" : ""}`}>{index + 1}</span><div><strong>{titleFor(event.eventType)}</strong><small>{event.location} · {formatDate(event.occurredAt)}{hasRisk ? " · Review signal recorded" : " · No review signal recorded"}</small></div><b>{eventValue(event)}</b></li>; })}</ol></section>
        <aside className="verify-side"><section className="verify-record"><p className="ops-eyebrow">Review signals</p><h2>Recorded evidence</h2>{anomalies.length ? anomalies.slice(0, 3).map((finding) => <div className="verify-price" key={finding.id}><div><span>{categoryLabels(finding.category)} · {finding.severity} review</span><strong>{finding.observedValue}</strong><small>Expected: {finding.expectedValue}</small></div><i aria-hidden="true" className={finding.severity === "high" ? "price-risk" : "price-reference"} style={{ width: finding.severity === "high" ? "94%" : "72%" }} /></div>) : <p className="verify-note">No review signals are stored for this record.</p>}<p className="verify-note">All displayed values are from persistent prototype records. A review signal is not proof of wrongdoing.</p></section>{transitFinding && <section className="verify-warning"><TriangleAlert size={19} /><div><p>Transit and quality note</p><h2>Review required.</h2><span>{transitFinding.explanation}</span></div></section>}<section className="verify-trust"><div><CircleCheck size={21} /><p><strong>What this record proves</strong><span>Recorded events form a tamper-evident application hash chain. This prototype does not claim an external blockchain anchor or prove every physical input.</span></p></div></section></aside>
      </div>
    </main>
  </div>;
}

function categoryLabels(category: string) {
  return ({ price: "Price", quantity: "Quantity", logistics: "Logistics", quality: "Quality" } as Record<string, string>)[category] ?? "Recorded";
}

function VerificationState({ label }: { label: string }) { return <div className="verify-app grid min-h-screen place-items-center p-6"><div className="verify-record max-w-md text-center"><p className="ops-eyebrow">AgriTrace intelligence</p><h1 className="mt-2 font-serif text-2xl">{label}</h1><p className="mt-3 text-sm text-slate-500">Please return to the operations console and retry.</p></div></div>; }

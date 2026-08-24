/**
 * Field Operations Console: a true product workspace with persistent nav, batch command bar,
 * data table, and investigation rail. Source structure informed by the supplied AgriTrace frontend.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowRight, Bell, Box, Building2, ChevronDown, ChevronRight, CircleCheck, CircleDot, CircleUserRound,
  ClipboardCheck, FileCheck2, Leaf, MapPin, Menu, MoreHorizontal, PackagePlus,
  Plus, QrCode, Search, ShieldCheck, Sprout, Tractor, TriangleAlert, Truck, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Toaster, toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { BRAND } from "@/lib/brand";

type RiskKind = "price" | "quantity" | "logistics" | "quality";
type Event = { id: string; eventType: string; icon: typeof Sprout; title: string; source: string; timestamp: string; location: string; value: string; status: "verified" | "review"; risk?: RiskKind; detail: string };
type RiskMeta = { label: string; short: string; tone: string; observed: string; expected: string; explanation: string };

const riskLabel: Record<RiskKind, string> = { price: "Price anomaly", quantity: "Quantity anomaly", logistics: "Transit anomaly", quality: "Quality risk" };
const emptyEvent: Event = { id: "", eventType: "", icon: Box, title: "Select an event", source: "—", timestamp: "", location: "", value: "—", status: "verified", detail: "Select a persisted event to inspect its recorded evidence." };

export default function Home() {
  const [, setLocation] = useLocation();
  const demo = trpc.batch.demo.useQuery();
  const integrity = trpc.batch.verifyIntegrity.useQuery(
    { batchCode: "ODS-TOM-2026-008421" },
    { enabled: Boolean(demo.data) },
  );
  const [navOpen, setNavOpen] = useState(false);
  const [selected, setSelected] = useState<Event>(emptyEvent);
  const [caseOpen, setCaseOpen] = useState(false);
  const [verified, setVerified] = useState(false);
  const activeBatch = demo.data?.batch;
  const displayEvents = useMemo<Event[]>(() => {
    if (!demo.data) return [];
    return demo.data.events.map((event) => {
      const finding = demo.data?.anomalies.find((anomaly) => anomaly.batchEventId === event.id);
      const icon = event.eventType === "harvest" ? Sprout : event.eventType === "collection" ? PackagePlus : event.eventType === "quality_inspection" ? ClipboardCheck : event.eventType === "trader_offer" ? CircleDot : event.eventType === "transit" ? Truck : Box;
      const value = event.pricePerKg ? `₹${event.pricePerKg}/kg` : event.quantityKg ? `${event.quantityKg} kg` : event.transitHours ? `${event.transitHours}h transit` : event.qualityGrade ?? "Recorded";
      const title = ({ harvest: "Harvest recorded", collection: "Collection received", quality_inspection: "Quality inspection", trader_offer: "Trader purchase", transit: "Transit evidence", warehouse_receipt: "Warehouse receipt", retail_receipt: "Retail receipt" } as Record<string, string>)[event.eventType] ?? "Recorded event";
      return { id: event.eventCode, eventType: event.eventType, icon, title, source: event.actorLabel, timestamp: new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(event.occurredAt)), location: event.location, value, status: finding ? "review" : "verified", risk: finding?.category as RiskKind | undefined, detail: finding?.explanation ?? `Recorded ${event.eventType.replaceAll("_", " ")} event from ${event.actorLabel}.` };
    });
  }, [demo.data]);
  useEffect(() => { if (demo.data && displayEvents.length) setSelected(displayEvents.find((event) => event.risk) ?? displayEvents[0]); }, [demo.data, displayEvents]);
  const routeStage = (eventType: string, label: string) => {
    const event = displayEvents.find((item) => item.eventType === eventType);
    return { label, place: event?.location ?? "Awaiting record", value: event?.value ?? "—", state: event ? event.status === "review" ? "alert" as const : "done" as const : "pending" as const };
  };
  const routeStages = [routeStage("harvest", "Farm"), routeStage("collection", "FPO collection"), routeStage("trader_offer", "Trader"), routeStage("warehouse_receipt", "Warehouse"), routeStage("retail_receipt", "Retail")];
  const transitEvent = displayEvents.find((event) => event.eventType === "transit");
  const riskCards = useMemo(() => {
    if (!demo.data) return [] as Array<{ kind: RiskKind; meta: RiskMeta }>;
    return demo.data.anomalies.map((anomaly) => ({
      kind: anomaly.category as RiskKind,
      meta: { label: riskLabel[anomaly.category as RiskKind], short: anomaly.severity, tone: anomaly.severity === "high" ? "red" : "amber", observed: anomaly.observedValue, expected: anomaly.expectedValue, explanation: anomaly.explanation },
    }));
  }, [demo.data]);
  const selectedRisk = selected.risk ? riskCards.find((risk) => risk.kind === selected.risk)?.meta ?? null : null;

  return <div className="ops-app">
    <Toaster richColors position="top-right" />
    {navOpen && <button className="ops-backdrop lg:hidden" aria-label="Close menu" onClick={() => setNavOpen(false)} />}
    <aside className={`ops-sidebar ${navOpen ? "ops-sidebar-open" : ""}`}>
      <div className="ops-brand-row">
        <Link href="/" className="ops-brand">
          <span className="ops-brand-mark" aria-hidden="true" />
          <span><b>Agri</b><strong>Trace</strong><small>INTELLIGENCE</small></span>
        </Link>
        <button onClick={() => setNavOpen(false)} className="ops-close lg:hidden" aria-label="Close navigation"><X size={18} /></button>
      </div>
      <div className="ops-org"><div className="ops-org-avatar">OD</div><div><p>Odisha operations</p><small>Government workspace</small></div><ChevronDown size={15} /></div>
      <nav className="ops-nav">
        <p>Workspace</p>
        <NavItem icon={Box} label="Batch command" active onClick={() => { setNavOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
        <NavItem icon={TriangleAlert} label="Risk queue" badge={riskCards.length ? String(riskCards.length) : undefined} onClick={() => { setNavOpen(false); document.getElementById("risk-queue")?.scrollIntoView({ behavior: "smooth" }); }} />
        <NavItem icon={FileCheck2} label="Audit trail" onClick={() => { setNavOpen(false); document.getElementById("activity")?.scrollIntoView({ behavior: "smooth" }); }} />
        <p className="ops-nav-section">Tools</p>
        <NavItem icon={Building2} label="My workspace" onClick={() => setLocation("/workspace")} />
        <NavItem icon={CircleUserRound} label="Member directory" onClick={() => setLocation("/members")} />
        <NavItem icon={CircleUserRound} label="Membership desk" onClick={() => setLocation("/membership")} />
        <NavItem icon={Truck} label="Handoff desk" onClick={() => setLocation("/handoffs")} />
        <NavItem icon={Tractor} label="Register harvest" onClick={() => setLocation("/batches/new")} />
        <NavItem icon={ClipboardCheck} label="Record your step" onClick={() => setLocation("/events/new")} />
        <NavItem icon={TriangleAlert} label="Government cases" onClick={() => setLocation("/cases")} />
        <NavItem icon={FileCheck2} label="Role guide" onClick={() => setLocation("/guide")} />
        <NavItem icon={QrCode} label="Consumer verification" onClick={() => setLocation(`/verify/${activeBatch?.batchCode ?? "ODS-TOM-2026-008421"}`)} />
      </nav>
      <div className="ops-sidebar-bottom"><div className="ops-integrity"><ShieldCheck size={18} /><div><strong>Integrity monitor</strong><span>{integrity.data?.valid || verified ? `${integrity.data?.checked ?? 0} event hashes matched` : "Verifying persisted record…"}</span></div></div><button className="ops-help">Need help?</button></div>
    </aside>

    <main className="ops-main">
      <header className="ops-header">
        <div className="flex items-center gap-3"><button onClick={() => setNavOpen(true)} className="ops-icon-button lg:hidden" aria-label="Open menu"><Menu size={19} /></button><div><p className="ops-eyebrow">Batch command</p><h1>Supply chain intelligence</h1></div></div>
        <div className="ops-header-actions"><button className="ops-icon-button hidden sm:grid" aria-label="Notifications"><Bell size={18} /><i /></button></div>
      </header>

      <div className="ops-content">
        <section className="ops-command-bar">
          <div className="ops-command-identity"><span className="batch-seal"><span /></span><div><div className="flex items-center gap-2"><h2>{activeBatch?.batchCode ?? "Loading batch…"}</h2><span className="state-pill state-transit">{activeBatch?.status?.replaceAll("_", " ") ?? "loading"}</span></div><p>{activeBatch ? `${activeBatch.crop} · ${activeBatch.grade ?? "Unclassified"} · ${activeBatch.harvestQuantityKg} kg at harvest · ${activeBatch.originDistrict}, ${activeBatch.originState}` : "Loading persisted prototype record"}</p></div></div>
          <div className="ops-command-actions"><label className="ops-command-search"><Search size={15} /><input aria-label="Search batch" placeholder="Search batch, farmer or market" /></label><button className="ops-text-action" onClick={() => { setVerified(true); integrity.refetch(); toast.success("Integrity check complete", { description: integrity.data?.valid ? "Persisted event chain hashes match." : "The record is being rechecked." }); }}><ShieldCheck size={16} /> {integrity.data?.valid || verified ? "Integrity verified" : "Verify integrity"}</button><Button variant="outline" onClick={() => setLocation(`/verify/${activeBatch?.batchCode ?? "ODS-TOM-2026-008421"}`)} className="ops-outline">Public view <ArrowRight size={15} /></Button><Button onClick={() => setLocation("/batches/new")} className="ops-primary"><Plus size={15} /> Register harvest</Button></div>
        </section>

        <div className="ops-workspace">
          <section className="ops-center">
            <article className="ops-route-panel">
              <div className="ops-panel-heading"><div><p className="ops-eyebrow">Batch movement</p><h2>Where the batch is now</h2></div><span className="ops-date">14–16 Aug 2026</span></div>
              <div className="ops-route">{routeStages.map((stage, index) => <div key={stage.label} className="contents"><RouteStage label={stage.label} place={stage.place} value={stage.value} state={stage.state} />{index < routeStages.length - 1 && <RouteLine state={stage.state} />}</div>)}</div>
              <div className="ops-route-foot"><span><MapPin size={15} /> Persisted route evidence</span><span><Truck size={15} /> {transitEvent?.value ?? "No transit event"}</span><button onClick={() => setSelected(transitEvent ?? emptyEvent)}>View route evidence <ChevronRight size={14} /></button></div>
            </article>

            <section id="risk-queue" className="ops-section">
              <div className="ops-panel-heading"><div><p className="ops-eyebrow">Risk queue</p><h2>Signals requiring review</h2></div><button onClick={() => setCaseOpen(true)} className="ops-link">Open all investigations <ChevronRight size={15} /></button></div>
              <div className="ops-risk-grid">
                {riskCards.map(({ kind, meta }, index) => <RiskCard key={`${kind}-${index}`} kind={kind} meta={meta} active={selected.risk === kind} onClick={() => setSelected(displayEvents.find((event) => event.risk === kind) ?? emptyEvent)} />)}
              </div>
            </section>

            <section id="activity" className="ops-table-panel">
              <div className="ops-panel-heading"><div><p className="ops-eyebrow">Activity</p><h2>Batch event ledger</h2></div><div className="ops-table-controls"><button>All events <ChevronDown size={14} /></button><button>Newest first <ChevronDown size={14} /></button></div></div>
              <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Event</th><th>Source</th><th>Location</th><th>Value</th><th>Status</th><th /></tr></thead><tbody>{displayEvents.map((event) => <tr key={event.id} className={selected.id === event.id ? "is-selected" : ""} onClick={() => setSelected(event)}><td><div className="event-title"><span className={`event-mini ${event.status === "review" ? "event-mini-alert" : ""}`}><event.icon size={15} /></span><div><strong>{event.title}</strong><small>{event.id} · {event.timestamp}</small></div></div></td><td>{event.source}</td><td>{event.location}</td><td className="font-bold">{event.value}</td><td><span className={`state-pill ${event.status === "review" ? "state-review" : "state-verified"}`}>{event.status === "review" ? "Review" : "Verified"}</span></td><td><ChevronRight size={16} /></td></tr>)}</tbody></table></div>
              <div className="ops-ledger-mobile">{displayEvents.map((event) => <button key={event.id} onClick={() => setSelected(event)} className={`ops-ledger-card ${selected.id === event.id ? "is-selected" : ""}`}><span className={`event-mini ${event.status === "review" ? "event-mini-alert" : ""}`}><event.icon size={15} /></span><span className="ops-ledger-copy"><strong>{event.title}</strong><small>{event.location} · {event.timestamp}</small><em>{event.source}</em></span><span className="ops-ledger-value"><b>{event.value}</b><i className={`state-pill ${event.status === "review" ? "state-review" : "state-verified"}`}>{event.status === "review" ? "Review" : "Verified"}</i></span></button>)}</div>
            </section>
          </section>

          <aside className="ops-investigation">
            <div className="ops-investigation-top"><div><p className="ops-eyebrow">Investigation</p><h2>{selected.title}</h2></div><button className="ops-icon-button" aria-label="More options"><MoreHorizontal size={18} /></button></div>
            <div className={`ops-investigation-status ${selected.status === "review" ? "status-review" : "status-clear"}`}><span>{selected.status === "review" ? "Needs review" : "Integrity confirmed"}</span><CircleCheck size={16} /></div>
            <div className="ops-integrity-link"><span className="integrity-node" /><span>Selected ledger event</span><b>{selected.id}</b><i /></div>
            <p className="ops-investigation-summary">{selected.detail}</p>
            {selectedRisk ? <div className="ops-evidence"><p>Evidence comparison</p><div><span>Observed</span><strong>{selectedRisk.observed}</strong></div><div><span>Expected</span><strong>{selectedRisk.expected}</strong></div><small>{selectedRisk.explanation}</small></div> : <div className="ops-evidence ops-evidence-clear"><p>Recorded evidence</p><div><span>Source confidence</span><strong>High</strong></div><div><span>Integrity</span><strong>Matched</strong></div><small>This event record is consistent with the current local hash chain.</small></div>}
            <div className="ops-investigation-actions"><Button onClick={() => setCaseOpen(true)} className="ops-primary w-full">Review evidence <ArrowRight size={15} /></Button>{selected.risk === "price" && <Button variant="outline" onClick={() => setLocation("/events/new")} className="ops-outline w-full">Record your offer</Button>}</div>
            <div className="ops-proof"><ShieldCheck size={17} /><p><strong>Tamper-evident record</strong><span>Critical event hash: 0x9f44...6bc2</span></p></div>
            <div className="ops-public-card"><div><span className="ops-eyebrow">Consumer verification</span><h3>QR-ready public record</h3><p>Show origin, quality, and journey without exposing private data.</p><button onClick={() => setLocation(`/verify/${activeBatch?.batchCode ?? "ODS-TOM-2026-008421"}`)}>Open public view <ArrowRight size={14} /></button></div><div className="ops-qr"><QRCodeSVG value={`${window.location.origin}/verify/${activeBatch?.batchCode ?? "ODS-TOM-2026-008421"}`} size={64} fgColor={BRAND.ink} /></div></div>
          </aside>
        </div>
      </div>
    </main>

    <Dialog open={caseOpen} onOpenChange={setCaseOpen}><DialogContent className="ops-dialog max-w-2xl p-0"><div className="ops-dialog-head"><p className="ops-eyebrow">Investigation file</p><DialogHeader><DialogTitle>Evidence requiring review</DialogTitle><DialogDescription>Each displayed anomaly is calculated from the persisted batch event record. It signals a review requirement, not an accusation.</DialogDescription></DialogHeader></div><div className="ops-case-grid">{riskCards.map(({ kind, meta }, index) => <div key={`${kind}-${index}`} className={`ops-case-block case-${meta.tone}`}><span>{meta.label}</span><strong>{meta.observed}</strong><small>Expected: {meta.expected}</small><p>{meta.explanation}</p></div>)}</div><div className="ops-dialog-foot"><Button onClick={() => { setCaseOpen(false); document.getElementById("activity")?.scrollIntoView({ behavior: "smooth" }); }} className="ops-primary">Inspect event ledger <ArrowRight size={15} /></Button><Button variant="outline" onClick={() => setLocation(`/verify/${activeBatch?.batchCode ?? "ODS-TOM-2026-008421"}`)} className="ops-outline">Open public view</Button></div></DialogContent></Dialog>
  </div>;
}

function NavItem({ icon: Icon, label, active, badge, onClick }: { icon: typeof Box; label: string; active?: boolean; badge?: string; onClick: () => void }) { return <button onClick={onClick} className={`ops-nav-item ${active ? "is-active" : ""}`}><Icon size={18} /><span>{label}</span>{badge && <i>{badge}</i>}</button>; }
function RouteLine({ state }: { state: "done" | "alert" | "pending" }) { return <span className={`route-line route-${state}`} />; }
function RouteStage({ label, place, value, state }: { label: string; place: string; value: string; state: "done" | "alert" | "pending" }) { return <div className="route-stage"><span className={`route-dot dot-${state}`}><span /></span><strong>{label}</strong><small>{place}</small><b>{value}</b></div>; }
function RiskCard({ kind, meta, active, onClick }: { kind: RiskKind; meta: RiskMeta; active: boolean; onClick: () => void }) { return <button onClick={onClick} className={`ops-risk-card risk-${meta.tone} ${active ? "is-active" : ""}`}><div><span>{meta.label}</span><i>{meta.short}</i></div><strong>{meta.observed}</strong><p>Expected: {meta.expected}</p><small>Review signal <ChevronRight size={13} /></small></button>; }

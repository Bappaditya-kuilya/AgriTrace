import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, ArrowRight, Loader2, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast, Toaster } from "sonner";

const roleLabel: Record<string, string> = {
  farmer: "Farmer", fpo_operator: "FPO operator", trader: "Trader", logistics_operator: "Logistics operator", warehouse_operator: "Warehouse operator", government_investigator: "Government investigator", government_supervisor: "Government supervisor",
};
const rolesByOrganizationType: Record<string, string[]> = {
  farm: ["farmer"], fpo: ["fpo_operator"], trader: ["trader"], logistics: ["logistics_operator"], warehouse: ["warehouse_operator"], government: ["government_investigator", "government_supervisor"],
};
type OrganizationRole = "farmer" | "fpo_operator" | "trader" | "logistics_operator" | "warehouse_operator" | "government_investigator" | "government_supervisor";

export default function MemberDirectory() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, loading, user } = useAuth();
  const utils = trpc.useUtils();
  const organizations = trpc.organization.listMine.useQuery(undefined, { enabled: isAuthenticated });
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole | "">("");

  const ownedOrganizations = useMemo(
    () => organizations.data?.filter((entry) => entry.organization.createdById === user?.id) ?? [],
    [organizations.data, user?.id],
  );
  const selectedOrganization = useMemo(
    () => ownedOrganizations.find((entry) => entry.organization.id === organizationId) ?? ownedOrganizations[0],
    [ownedOrganizations, organizationId],
  );
  const members = trpc.organization.members.useQuery(
    { organizationId: organizationId ?? 0 },
    { enabled: Boolean(organizationId) },
  );

  useEffect(() => {
    if (selectedOrganization) setOrganizationId(selectedOrganization.organization.id);
  }, [selectedOrganization?.organization.id]);

  useEffect(() => {
    const allowedRoles = selectedOrganization ? rolesByOrganizationType[selectedOrganization.organization.type] ?? [] : [];
    setRole((allowedRoles[0] ?? "") as OrganizationRole | "");
  }, [selectedOrganization?.organization.type]);

  const addExistingMember = trpc.organization.addExistingMember.useMutation({
    onSuccess: async () => {
      setEmail("");
      await utils.organization.members.invalidate();
      toast.success("Member role added", { description: "The user can now act through this organization." });
    },
    onError: (error) => toast.error("Member could not be added", { description: error.message }),
  });

  if (loading || organizations.isLoading) return <PageState title="Preparing the member directory" />;
  if (!isAuthenticated) return <PageState title="Sign in to manage organization members" detail="Only organization owners and application administrators can access this directory." />;

  const allowedRoles = selectedOrganization ? rolesByOrganizationType[selectedOrganization.organization.type] ?? [] : [];
  const hasOwnedOrganization = ownedOrganizations.length > 0;

  return <main className="min-h-screen atlas-canvas atlas-ink-text">
    <Toaster richColors position="top-right" />
    <header className="border-b atlas-border bg-white">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-full border atlas-border atlas-canvas"><UsersRound size={16} /></span> AgriTrace Intelligence</Link>
        <Button variant="outline" onClick={() => setLocation("/workspace")} className="atlas-border bg-white atlas-ink-text"><ArrowLeft size={16} /> Workspace</Button>
      </div>
    </header>
    <div className="mx-auto grid max-w-[1180px] gap-7 px-5 py-8 lg:grid-cols-[250px_minmax(0,1fr)_310px]">
      <aside className="border atlas-ink-border atlas-ink-surface p-5 text-white">
        <p className="text-[10px] font-bold uppercase tracking-[.18em] atlas-dark-muted">Owner controls</p>
        <h1 className="mt-3 font-serif text-2xl leading-tight">Keep organization roles understandable.</h1>
        <p className="mt-4 text-sm leading-6 atlas-dark-muted">Add people who have already signed in to AgriTrace. Their role must match this organization type.</p>
        <div className="mt-8 border-t border-white/10 pt-5 text-xs leading-5 atlas-dark-muted"><ShieldCheck className="mb-2 atlas-dark-muted" size={18} />A member sees a batch only when its owner separately assigns the organization through the Handoff Desk.</div>
      </aside>
      <section>
        <p className="text-xs font-bold uppercase tracking-[.18em] atlas-muted-text">Organization directory</p>
        <h2 className="mt-1 font-serif text-4xl">People who can act in your workspace.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 atlas-muted-text">Only organizations you created are selectable. The directory exposes active members and their operational role, not private batch records.</p>
        {hasOwnedOrganization ? <>
          <Label className="mt-6 block" htmlFor="owned-organization">Organization you own</Label>
          <select id="owned-organization" value={organizationId ?? ""} onChange={(event) => setOrganizationId(Number(event.target.value))} className="mt-1 h-11 w-full border atlas-border bg-white px-3 text-sm">
            {ownedOrganizations.map((entry) => <option key={entry.organization.id} value={entry.organization.id}>{entry.organization.name} · {entry.organization.type}</option>)}
          </select>
          <section className="mt-5 border atlas-border bg-white">
            <div className="flex items-center justify-between border-b atlas-border px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] atlas-muted-text">Member directory</p><h3 className="mt-1 text-lg font-semibold">Active organization roles</h3></div><span className="rounded-full atlas-canvas px-3 py-1 text-xs font-bold atlas-action-text">{members.data?.length ?? 0} people</span></div>
            <div className="divide-y atlas-divide">{members.data?.map(({ member, user: memberUser }) => <div className="flex items-center justify-between gap-4 px-5 py-4" key={member.id}><div><strong className="text-sm">{memberUser.name || "Unnamed user"}</strong><p className="mt-1 text-xs atlas-muted-text">{memberUser.email || "No email available"}</p></div><div className="text-right"><span className="rounded-full atlas-canvas px-2 py-1 text-xs font-semibold atlas-action-text">{roleLabel[member.role] ?? member.role}</span><p className="mt-2 text-[10px] font-bold uppercase tracking-[.12em] atlas-muted-text">{member.status}</p></div></div>)}</div>
          </section>
        </> : <section className="mt-6 border atlas-border bg-white p-6"><h3 className="font-semibold">Create an organization that you own first.</h3><p className="mt-2 text-sm leading-6 atlas-muted-text">Member management is limited to organization creators, so participants cannot expose another organization’s people.</p><Button onClick={() => setLocation("/workspace")} className="mt-4 atlas-action text-white atlas-action-hover">Open workspace <ArrowRight size={16} /></Button></section>}
      </section>
      <aside className="h-fit border atlas-border bg-white p-5 lg:sticky lg:top-6">
        <p className="text-[10px] font-bold uppercase tracking-[.15em] atlas-muted-text">Add existing user</p>
        <h3 className="mt-2 text-xl font-semibold">Assign an active role</h3>
        <p className="mt-2 text-sm leading-6 atlas-muted-text">The person must already have an AgriTrace account. This does not send email or use a paid service.</p>
        <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); if (organizationId && email && role) addExistingMember.mutate({ organizationId, email, role }); }}>
          <div><Label htmlFor="member-email">Signed-in user email</Label><Input id="member-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="person@example.com" className="mt-1 atlas-border bg-white" required /></div>
          <div><Label htmlFor="member-role">Role in this organization</Label><select id="member-role" value={role} onChange={(event) => setRole(event.target.value as OrganizationRole)} className="mt-1 h-10 w-full border atlas-border bg-white px-3 text-sm" disabled={!selectedOrganization}>{allowedRoles.map((value) => <option key={value} value={value}>{roleLabel[value]}</option>)}</select></div>
          <Button type="submit" disabled={addExistingMember.isPending || !organizationId || !role} className="w-full atlas-action text-white atlas-action-hover">{addExistingMember.isPending ? "Assigning role…" : "Add active member"} <UserPlus size={16} /></Button>
        </form>
      </aside>
    </div>
  </main>;
}

function PageState({ title, detail }: { title: string; detail?: string }) {
  return <main className="flex min-h-screen items-center justify-center atlas-canvas p-6 text-center"><section className="max-w-md border atlas-border bg-white p-8"><Loader2 className={detail ? "mx-auto atlas-action-text" : "mx-auto animate-spin atlas-action-text"} size={24} /><h1 className="mt-4 font-serif text-2xl atlas-ink-text">{title}</h1>{detail && <p className="mt-2 text-sm atlas-muted-text">{detail}</p>}</section></main>;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface EmployeeEditData {
  id: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  alternativePhone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  workLocation: string | null;
  departmentId: string | null;
  positionId: string | null;
  managerId: string | null;
  employmentDate: string | null;
  confirmationDate: string | null;
  endDate: string | null;
  employmentType: string | null;
  status: string;
  notes: string | null;
}

interface Option { id: string; name?: string; title?: string; fullName?: string; employeeId?: string; departmentId?: string | null; }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EmployeeEditData;
  onSaved: () => void;
}

const NONE = "__none__";

function dateValue(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export function EmployeeEditDialog({ open, onOpenChange, employee, onSaved }: Props) {
  const [form, setForm] = useState({
    firstName: "", middleName: "", lastName: "", preferredName: "", email: "",
    phone: "", alternativePhone: "", dateOfBirth: "", gender: "",
    address: "", city: "", workLocation: "", departmentId: "", positionId: "",
    managerId: "", employmentDate: "", confirmationDate: "", endDate: "",
    employmentType: "", status: "active", notes: "",
  });
  const [departments, setDepartments] = useState<Option[]>([]);
  const [positions, setPositions] = useState<Option[]>([]);
  const [managers, setManagers] = useState<Option[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      firstName: employee.firstName ?? "",
      middleName: employee.middleName ?? "",
      lastName: employee.lastName ?? "",
      preferredName: employee.preferredName ?? "",
      email: employee.email ?? "",
      phone: employee.phone ?? "",
      alternativePhone: employee.alternativePhone ?? "",
      dateOfBirth: dateValue(employee.dateOfBirth),
      gender: employee.gender ?? "",
      address: employee.address ?? "",
      city: employee.city ?? "",
      workLocation: employee.workLocation ?? "",
      departmentId: employee.departmentId ?? "",
      positionId: employee.positionId ?? "",
      managerId: employee.managerId ?? "",
      employmentDate: dateValue(employee.employmentDate),
      confirmationDate: dateValue(employee.confirmationDate),
      endDate: dateValue(employee.endDate),
      employmentType: employee.employmentType ?? "",
      status: employee.status ?? "active",
      notes: employee.notes ?? "",
    });
    setLoadingOptions(true);
    Promise.all([
      fetch("/api/departments"),
      fetch("/api/positions"),
      fetch("/api/staff?page=1&pageSize=100&status=active"),
    ]).then(async ([d, p, s]) => {
      if (!d.ok || !p.ok || !s.ok) throw new Error("Failed to load employee options.");
      const [dj, pj, sj] = await Promise.all([d.json(), p.json(), s.json()]);
      setDepartments(dj.items ?? []);
      setPositions(pj.items ?? []);
      setManagers((sj.items ?? []).filter((m: Option) => m.id !== employee.id));
    }).catch((err) => {
      toast.error(err instanceof Error ? err.message : "Failed to load employee options.");
    }).finally(() => setLoadingOptions(false));
  }, [open, employee]);

  const filteredPositions = useMemo(
    () => positions.filter((p) => !form.departmentId || !p.departmentId || p.departmentId === form.departmentId),
    [positions, form.departmentId],
  );

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!form.firstName.trim() && !form.lastName.trim()) {
      toast.error("Enter at least a first name or last name.");
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error("Enter a valid email address.");
      return;
    }

    setSaving(true);
    try {
      const body = {
        firstName: form.firstName.trim() || null,
        middleName: form.middleName.trim() || null,
        lastName: form.lastName.trim() || null,
        preferredName: form.preferredName.trim() || null,
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        alternativePhone: form.alternativePhone.trim() || null,
        dateOfBirth: form.dateOfBirth || undefined,
        gender: form.gender || undefined,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        workLocation: form.workLocation.trim() || null,
        departmentId: form.departmentId || null,
        positionId: form.positionId || null,
        managerId: form.managerId || null,
        employmentDate: form.employmentDate || null,
        confirmationDate: form.confirmationDate || null,
        endDate: form.endDate || null,
        employmentType: form.employmentType || null,
        status: form.status,
        notes: form.notes.trim() || null,
      };
      const res = await fetch(`/api/staff/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error ?? "Failed to update employee.");
        return;
      }
      toast.success("Employee updated successfully.");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Network error while updating employee.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit Employee</DialogTitle>
          <DialogDescription>Update the employee record. Employee ID remains unchanged.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 sm:grid-cols-3">
          <Field label="First name"><Input value={form.firstName} onChange={(e) => update("firstName", e.target.value)} /></Field>
          <Field label="Middle name"><Input value={form.middleName} onChange={(e) => update("middleName", e.target.value)} /></Field>
          <Field label="Last name"><Input value={form.lastName} onChange={(e) => update("lastName", e.target.value)} /></Field>
          <Field label="Preferred name"><Input value={form.preferredName} onChange={(e) => update("preferredName", e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => update("phone", e.target.value)} /></Field>
          <Field label="Alternative phone"><Input value={form.alternativePhone} onChange={(e) => update("alternativePhone", e.target.value)} /></Field>
          <Field label="Date of birth"><Input type="date" value={form.dateOfBirth} onChange={(e) => update("dateOfBirth", e.target.value)} /></Field>
          <Field label="Gender">
            <Select value={form.gender || NONE} onValueChange={(v) => update("gender", v === NONE ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>Not specified</SelectItem><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="City"><Input value={form.city} onChange={(e) => update("city", e.target.value)} /></Field>
          <Field label="Work location"><Input value={form.workLocation} onChange={(e) => update("workLocation", e.target.value)} /></Field>
          <Field label="Address" className="sm:col-span-3"><Input value={form.address} onChange={(e) => update("address", e.target.value)} /></Field>

          <Field label="Department">
            <Select value={form.departmentId || NONE} onValueChange={(v) => { update("departmentId", v === NONE ? "" : v); if (v !== form.departmentId) update("positionId", ""); }}>
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>No department</SelectItem>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Position">
            <Select value={form.positionId || NONE} onValueChange={(v) => update("positionId", v === NONE ? "" : v)} disabled={loadingOptions}>
              <SelectTrigger><SelectValue placeholder={loadingOptions ? "Loading..." : "Select position"} /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>No position</SelectItem>{filteredPositions.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Manager">
            <Select value={form.managerId || NONE} onValueChange={(v) => update("managerId", v === NONE ? "" : v)} disabled={loadingOptions}>
              <SelectTrigger><SelectValue placeholder={loadingOptions ? "Loading..." : "Select manager"} /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>No manager</SelectItem>{managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName} ({m.employeeId})</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Employment type">
            <Select value={form.employmentType || NONE} onValueChange={(v) => update("employmentType", v === NONE ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>Not specified</SelectItem><SelectItem value="full_time">Full-time</SelectItem><SelectItem value="part_time">Part-time</SelectItem><SelectItem value="contract">Contract</SelectItem><SelectItem value="temporary">Temporary</SelectItem><SelectItem value="intern">Intern</SelectItem><SelectItem value="consultant">Consultant</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => update("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="probation">Probation</SelectItem><SelectItem value="on_leave">On leave</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="resigned">Resigned</SelectItem><SelectItem value="terminated">Terminated</SelectItem><SelectItem value="retired">Retired</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Employment date"><Input type="date" value={form.employmentDate} onChange={(e) => update("employmentDate", e.target.value)} /></Field>
          <Field label="Confirmation date"><Input type="date" value={form.confirmationDate} onChange={(e) => update("confirmationDate", e.target.value)} /></Field>
          <Field label="End date"><Input type="date" value={form.endDate} onChange={(e) => update("endDate", e.target.value)} /></Field>
          <Field label="Notes" className="sm:col-span-3"><Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={3} /></Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loadingOptions}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-1.5 block">{label}</Label>{children}</div>;
}

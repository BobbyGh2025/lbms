"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DepartmentOption {
  id: string;
  name: string;
  code: string | null;
}

interface PositionOption {
  id: string;
  title: string;
  departmentId?: string | null;
}

interface ManagerOption {
  id: string;
  fullName: string;
  employeeId: string;
  status: string;
}

interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  alternativePhone: string;
  address: string;
  isPrimary: boolean;
}

interface EmployeeCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments: DepartmentOption[];
  onCreated: () => void;
}

const EMPTY_CONTACT: EmergencyContact = {
  name: "",
  relationship: "",
  phone: "",
  alternativePhone: "",
  address: "",
  isPrimary: true,
};

const EMPTY_FORM = {
  firstName: "",
  middleName: "",
  lastName: "",
  preferredName: "",
  email: "",
  phone: "",
  alternativePhone: "",
  dateOfBirth: "",
  gender: "",
  address: "",
  city: "",
  workLocation: "",
  departmentId: "",
  positionId: "",
  managerId: "",
  employmentDate: "",
  confirmationDate: "",
  employmentType: "",
  status: "active",
  notes: "",
};

export function EmployeeCreateDialog({
  open,
  onOpenChange,
  departments,
  onCreated,
}: EmployeeCreateDialogProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeDepartments = useMemo(
    () => departments.filter((d) => d.id),
    [departments],
  );

  useEffect(() => {
    if (!open) return;
    setLoadingOptions(true);
    (async () => {
      try {
        const [positionRes, staffRes] = await Promise.all([
          fetch("/api/positions"),
          fetch("/api/staff?page=1&pageSize=100&status=active"),
        ]);
        if (!positionRes.ok) {
          throw new Error("Failed to load positions.");
        }
        if (!staffRes.ok) {
          throw new Error("Failed to load managers.");
        }
        const positionJson = await positionRes.json();
        const staffJson = await staffRes.json();
        setPositions(
          (positionJson.items ?? []).map((p: PositionOption) => ({
            id: p.id,
            title: p.title,
            departmentId: p.departmentId ?? null,
          })),
        );
        setManagers(staffJson.items ?? []);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load employee options.");
      } finally {
        setLoadingOptions(false);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!form.departmentId && form.positionId) {
      setForm((current) => ({ ...current, positionId: "" }));
      return;
    }
    if (
      form.positionId &&
      !positions.some(
        (p) => p.id === form.positionId && (!form.departmentId || p.departmentId === form.departmentId),
      )
    ) {
      setForm((current) => ({ ...current, positionId: "" }));
    }
  }, [form.departmentId, form.positionId, positions]);

  const filteredPositions = useMemo(
    () =>
      positions.filter(
        (p) => !form.departmentId || !p.departmentId || p.departmentId === form.departmentId,
      ),
    [positions, form.departmentId],
  );

  function update<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function reset() {
    setForm(EMPTY_FORM);
    setContacts([]);
  }

  function close() {
    if (saving) return;
    onOpenChange(false);
    reset();
  }

  function addContact() {
    setContacts((current) => [
      ...current,
      { ...EMPTY_CONTACT, isPrimary: current.length === 0 },
    ]);
  }

  function updateContact(index: number, patch: Partial<EmergencyContact>) {
    setContacts((current) =>
      current.map((contact, i) => (i === index ? { ...contact, ...patch } : contact)),
    );
  }

  function removeContact(index: number) {
    setContacts((current) => current.filter((_, i) => i !== index));
  }

  async function submit() {
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();

    if (!firstName && !lastName) {
      toast.error("Enter at least a first name or last name.");
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error("Enter a valid email address.");
      return;
    }

    const invalidContact = contacts.find(
      (contact) => !contact.name.trim() || !contact.phone.trim(),
    );
    if (invalidContact) {
      toast.error("Each emergency contact needs a name and phone number.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        firstName: firstName || undefined,
        middleName: form.middleName.trim() || undefined,
        lastName: lastName || undefined,
        preferredName: form.preferredName.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        alternativePhone: form.alternativePhone.trim() || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        gender: form.gender || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        workLocation: form.workLocation.trim() || undefined,
        departmentId: form.departmentId || undefined,
        positionId: form.positionId || undefined,
        managerId: form.managerId || undefined,
        employmentDate: form.employmentDate || undefined,
        confirmationDate: form.confirmationDate || undefined,
        employmentType: form.employmentType || undefined,
        status: form.status || "active",
        notes: form.notes.trim() || undefined,
        emergencyContacts: contacts.map((contact) => ({
          name: contact.name.trim(),
          relationship: contact.relationship.trim() || undefined,
          phone: contact.phone.trim(),
          alternativePhone: contact.alternativePhone.trim() || undefined,
          address: contact.address.trim() || undefined,
          isPrimary: contact.isPrimary,
        })),
      };

      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error ?? "Failed to create employee.");
        return;
      }

      toast.success(
        json?.employeeNumber
          ? `Employee created — ${json.employeeNumber}`
          : "Employee created successfully.",
      );
      onOpenChange(false);
      reset();
      onCreated();
    } catch {
      toast.error("Network error while creating employee.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New Employee</DialogTitle>
          <DialogDescription>
            Create a staff record. The system will generate the Employee ID and employee number automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Identity & Contact</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="First name" required>
                <Input value={form.firstName} onChange={(e) => update("firstName", e.target.value)} />
              </Field>
              <Field label="Last name" required>
                <Input value={form.lastName} onChange={(e) => update("lastName", e.target.value)} />
              </Field>
              <Field label="Middle name">
                <Input value={form.middleName} onChange={(e) => update("middleName", e.target.value)} />
              </Field>
              <Field label="Preferred name">
                <Input value={form.preferredName} onChange={(e) => update("preferredName", e.target.value)} />
              </Field>
              <Field label="Gender">
                <Select value={form.gender} onValueChange={(v) => update("gender", v)}>
                  <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
              </Field>
              <Field label="Alternative phone">
                <Input value={form.alternativePhone} onChange={(e) => update("alternativePhone", e.target.value)} />
              </Field>
              <Field label="Date of birth">
                <Input type="date" value={form.dateOfBirth} onChange={(e) => update("dateOfBirth", e.target.value)} />
              </Field>
              <Field label="City">
                <Input value={form.city} onChange={(e) => update("city", e.target.value)} />
              </Field>
              <Field label="Work location">
                <Input value={form.workLocation} onChange={(e) => update("workLocation", e.target.value)} />
              </Field>
              <Field label="Address" className="sm:col-span-3">
                <Input value={form.address} onChange={(e) => update("address", e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Employment</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Department">
                <Select value={form.departmentId} onValueChange={(v) => update("departmentId", v)}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {activeDepartments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Position">
                <Select value={form.positionId} onValueChange={(v) => update("positionId", v)} disabled={loadingOptions || filteredPositions.length === 0}>
                  <SelectTrigger><SelectValue placeholder={loadingOptions ? "Loading..." : "Select position"} /></SelectTrigger>
                  <SelectContent>
                    {filteredPositions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Manager">
                <Select value={form.managerId} onValueChange={(v) => update("managerId", v)} disabled={loadingOptions}>
                  <SelectTrigger><SelectValue placeholder={loadingOptions ? "Loading..." : "Select manager"} /></SelectTrigger>
                  <SelectContent>
                    {managers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.fullName} ({m.employeeId})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Employment type">
                <Select value={form.employmentType} onValueChange={(v) => update("employmentType", v)}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_time">Full-time</SelectItem>
                    <SelectItem value="part_time">Part-time</SelectItem>
                    <SelectItem value="contract">Contract</SelectItem>
                    <SelectItem value="temporary">Temporary</SelectItem>
                    <SelectItem value="intern">Intern</SelectItem>
                    <SelectItem value="consultant">Consultant</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => update("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="probation">Probation</SelectItem>
                    <SelectItem value="on_leave">On leave</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Employment date">
                <Input type="date" value={form.employmentDate} onChange={(e) => update("employmentDate", e.target.value)} />
              </Field>
              <Field label="Confirmation date">
                <Input type="date" value={form.confirmationDate} onChange={(e) => update("confirmationDate", e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Emergency contacts</h3>
                <p className="text-xs text-muted-foreground">Optional, but each contact needs a name and phone.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addContact}>
                <Plus className="h-4 w-4" /> Add contact
              </Button>
            </div>
            {contacts.map((contact, index) => (
              <div key={index} className="rounded-lg border p-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Name" required>
                    <Input value={contact.name} onChange={(e) => updateContact(index, { name: e.target.value })} />
                  </Field>
                  <Field label="Relationship">
                    <Input value={contact.relationship} onChange={(e) => updateContact(index, { relationship: e.target.value })} />
                  </Field>
                  <Field label="Phone" required>
                    <Input value={contact.phone} onChange={(e) => updateContact(index, { phone: e.target.value })} />
                  </Field>
                  <div className="flex items-end">
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeContact(index)} className="text-destructive">
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Notes</h3>
            <Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Optional HR notes" rows={3} />
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={saving || loadingOptions}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {saving ? "Creating..." : "Create Employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

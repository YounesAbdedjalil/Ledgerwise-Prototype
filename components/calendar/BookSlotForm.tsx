"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bookSlot } from "@/app/(dashboard)/calendar/actions";
import {
  DEFAULT_TIMEZONE,
  TIMEZONE_OPTIONS,
} from "@/lib/calendar/time";

type SlotOption = { id: string; label: string };
type CompanyOption = {
  id: string;
  name: string;
  contact_name: string;
  contact_email: string | null;
};
type ConversationOption = {
  id: string;
  label: string;
  company_id: string;
  contact_email: string;
};

export default function BookSlotForm({
  slots,
  companies,
  conversations,
  defaultSlotId,
  defaultCompanyId,
  defaultConversationId,
}: {
  slots: SlotOption[];
  companies: CompanyOption[];
  conversations: ConversationOption[];
  defaultSlotId?: string;
  defaultCompanyId?: string;
  defaultConversationId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [slotId, setSlotId] = useState(defaultSlotId ?? slots[0]?.id ?? "");
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? "");
  const [conversationId, setConversationId] = useState(defaultConversationId ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function applyCompany(id: string) {
    setCompanyId(id);
    const company = companies.find((item) => item.id === id);
    if (company) {
      if (company.contact_name !== "unknown") setName(company.contact_name);
      if (company.contact_email) setEmail(company.contact_email);
    }
  }

  function applyConversation(id: string) {
    setConversationId(id);
    const conversation = conversations.find((item) => item.id === id);
    if (conversation) {
      setEmail(conversation.contact_email);
      if (!companyId) setCompanyId(conversation.company_id);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await bookSlot({
        slotId,
        companyId: companyId || null,
        conversationId: conversationId || null,
        prospectName: name,
        prospectEmail: email,
        timezone,
      });
      if (!result.ok) {
        setError(result.error ?? "The booking could not be created.");
        return;
      }
      setNotice(result.message ?? "Booking created.");
      router.refresh();
    });
  }

  if (slots.length === 0) {
    return (
      <p className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        There are no free future internal slots. Create a slot or cancel an active
        booking first.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded border bg-white p-4">
      <h3 className="font-medium">Book a slot</h3>
      <p className="text-xs text-gray-500">
        Pending, confirmed, and needs-human bookings hold the slot. Cancelled and
        rescheduled bookings release it.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs sm:col-span-2">
          <span className="font-medium text-gray-700">Slot</span>
          <select
            value={slotId}
            onChange={(event) => setSlotId(event.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          >
            {slots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="font-medium text-gray-700">Company</span>
          <select
            value={companyId}
            onChange={(event) => applyCompany(event.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          >
            <option value="">No company</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="font-medium text-gray-700">Conversation</span>
          <select
            value={conversationId}
            onChange={(event) => applyConversation(event.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          >
            <option value="">No conversation</option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="font-medium text-gray-700">Prospect name</span>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          />
        </label>

        <label className="space-y-1 text-xs">
          <span className="font-medium text-gray-700">Prospect email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          />
        </label>

        <label className="space-y-1 text-xs sm:col-span-2">
          <span className="font-medium text-gray-700">Prospect timezone</span>
          <select
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          >
            {TIMEZONE_OPTIONS.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}
      {notice && <p className="text-xs text-green-700">{notice}</p>}

      <button
        type="submit"
        disabled={pending || !slotId}
        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "Booking..." : "Create booking"}
      </button>
    </form>
  );
}
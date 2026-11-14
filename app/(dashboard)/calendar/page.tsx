import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import {
  activeBookingForSlot,
  formatSlotRange,
} from "@/lib/calendar/time";
import { googleCalendarStatus } from "@/lib/calendar/google";
import SlotCreator from "@/components/calendar/SlotCreator";
import SlotDeleteButton from "@/components/calendar/SlotDeleteButton";
import BookSlotForm from "@/components/calendar/BookSlotForm";
import BookingActions from "@/components/calendar/BookingActions";

type Slot = {
  id: string;
  start_time: string;
  end_time: string;
  timezone: string;
  source: string;
  is_available: boolean;
};

type Booking = {
  id: string;
  slot_id: string | null;
  status: string;
  prospect_name: string | null;
  prospect_email: string;
  timezone: string;
  created_at: string;
  google_event_id: string | null;
  calendar_sync_status: string;
  company_id: string | null;
  conversation_id: string | null;
  companies: { name: string } | { name: string }[] | null;
};

type Company = {
  id: string;
  name: string;
  contact_name: string;
  contact_email: string | null;
};

type Conversation = {
  id: string;
  contact_email: string;
  company_id: string;
  status: string;
  companies: { name: string } | { name: string }[] | null;
};

function companyName(
  value: { name: string } | { name: string }[] | null | undefined
): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0]?.name ?? null : value.name;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string; company?: string }>;
}) {
  const params = await searchParams;
  const defaultConversationId =
    params.conversation && isUuid(params.conversation) ? params.conversation : undefined;
  const defaultCompanyId =
    params.company && isUuid(params.company) ? params.company : undefined;

  const supabase = await createClient();
  const now = new Date().toISOString();
  const [
    { data: slotData, error: slotError },
    { data: bookingData },
    { data: companyData },
    { data: conversationData },
  ] = await Promise.all([
    supabase
      .from("calendar_slots")
      .select("id,start_time,end_time,timezone,source,is_available")
      .gte("end_time", now)
      .order("start_time", { ascending: true })
      .limit(200),
    supabase
      .from("bookings")
      .select(
        "id,slot_id,status,prospect_name,prospect_email,timezone,created_at,company_id,conversation_id,google_event_id,calendar_sync_status,companies(name)"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("companies")
      .select("id,name,contact_name,contact_email")
      .order("name")
      .limit(200),
    supabase
      .from("conversations")
      .select("id,contact_email,company_id,status,companies(name)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const slots = (slotData ?? []) as Slot[];
  const bookings = (bookingData ?? []) as unknown as Booking[];
  const companies = (companyData ?? []) as Company[];
  const conversations = (conversationData ?? []) as unknown as Conversation[];
  const google = googleCalendarStatus();

  const activeBookings = bookings.filter(
    (booking) =>
      booking.status === "pending" ||
      booking.status === "confirmed" ||
      booking.status === "needs_human"
  );
  const activeBySlot = new Map(
    activeBookings
      .filter((booking) => booking.slot_id)
      .map((booking) => [booking.slot_id as string, booking])
  );

  const freeSlotOptions = slots
    .filter((slot) => slot.is_available && !activeBySlot.has(slot.id))
    .map((slot) => ({
      id: slot.id,
      label: formatSlotRange(slot.start_time, slot.end_time, slot.timezone),
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Calendar / Bookings</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          The internal calendar is the source of truth. Defaults are America/New_York,
          30-minute slots, 9:00–17:00 local time, with durations from 15 to 120 minutes.
          Only pending, confirmed, and needs-human bookings hold a slot.
        </p>
      </div>

      <div
        className={`rounded border p-4 text-sm ${
          google.operational
            ? "border-green-200 bg-green-50 text-green-900"
            : "border-gray-200 bg-white text-gray-700"
        }`}
      >
        <div className="font-medium">
          Google Calendar: {google.operational ? "sync enabled" : "not operational"}
        </div>
        <p className="mt-1 text-xs">{google.reason}</p>
        <p className="mt-1 text-xs text-gray-500">
          The prototype does not claim Google Calendar is working until real OAuth and
          sync have been tested. Internal slots and bookings work without it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SlotCreator />
        <BookSlotForm
          slots={freeSlotOptions}
          companies={companies}
          conversations={conversations.map((conversation) => ({
            id: conversation.id,
            label: `${companyName(conversation.companies) ?? "Unknown"} · ${
              conversation.contact_email
            } · ${conversation.status}`,
            company_id: conversation.company_id,
            contact_email: conversation.contact_email,
          }))}
          defaultCompanyId={defaultCompanyId}
          defaultConversationId={defaultConversationId}
        />
      </div>

      {slotError && <p className="text-sm text-red-600">{slotError.message}</p>}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Internal slots</h2>
        {slots.length === 0 ? (
          <p className="rounded border bg-white p-4 text-sm text-gray-600">
            No future slots. Create one above.
          </p>
        ) : (
          <table className="w-full rounded border bg-white text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-2">Time</th>
                <th className="p-2">Source</th>
                <th className="p-2">Held by</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => {
                const active =
                  activeBySlot.get(slot.id) ??
                  activeBookingForSlot(activeBookings, slot.id);
                return (
                  <tr key={slot.id} className="border-t align-top">
                    <td className="p-2">
                      {formatSlotRange(slot.start_time, slot.end_time, slot.timezone)}
                    </td>
                    <td className="p-2 text-xs text-gray-600">{slot.source}</td>
                    <td className="p-2 text-xs">
                      {active ? (
                        <span>
                          {active.prospect_name ?? active.prospect_email} ·{" "}
                          {active.status}
                        </span>
                      ) : slot.is_available ? (
                        <span className="text-green-700">free</span>
                      ) : (
                        <span className="text-gray-500">unavailable</span>
                      )}
                    </td>
                    <td className="p-2">
                      <SlotDeleteButton slotId={slot.id} disabled={Boolean(active)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Bookings</h2>
        {bookings.length === 0 ? (
          <p className="rounded border bg-white p-4 text-sm text-gray-600">
            No bookings yet. Book a free slot above, or open a conversation with a
            booking request.
          </p>
        ) : (
          <table className="w-full rounded border bg-white text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-2">Prospect</th>
                <th className="p-2">Company</th>
                <th className="p-2">Slot</th>
                <th className="p-2">Status</th>
                <th className="p-2">Created</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => {
                const slot = slots.find((item) => item.id === booking.slot_id);
                return (
                  <tr key={booking.id} className="border-t align-top">
                    <td className="p-2">
                      <div className="font-medium">
                        {booking.prospect_name ?? "Unknown"}
                      </div>
                      <div className="text-xs text-gray-600">
                        {booking.prospect_email}
                      </div>
                    </td>
                    <td className="p-2 text-xs">
                      {companyName(booking.companies) ?? "—"}
                    </td>
                    <td className="p-2 text-xs">
                      {slot
                        ? formatSlotRange(slot.start_time, slot.end_time, slot.timezone)
                        : "No slot"}
                    </td>
                    <td className="p-2 text-xs">
                      <div>{booking.status}</div>
                      <div className="text-gray-500">
                        Google: {booking.calendar_sync_status}
                        {booking.google_event_id ? " (linked)" : ""}
                      </div>
                    </td>
                    <td className="p-2 text-xs text-gray-500">
                      {booking.created_at.slice(0, 10)}
                    </td>
                    <td className="p-2">
                      <BookingActions
                        bookingId={booking.id}
                        status={booking.status}
                        currentSlotId={booking.slot_id}
                        slots={freeSlotOptions}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
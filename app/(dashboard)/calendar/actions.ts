"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, type ServerSupabase } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/audit";
import { isSuppressed } from "@/lib/suppression";
import { isValidEmail, isUuid, normalizeEmail, trimText } from "@/lib/validation";
import {
  OCCUPYING_BOOKING_STATUSES,
  validateBookingInput,
  validateSlotInput,
} from "@/lib/calendar/time";
import {
  deleteGoogleEvent,
  syncBookingToGoogle,
  updateGoogleEvent,
  type GoogleEventInput,
} from "@/lib/calendar/google";

export type CalendarActionResult = {
  ok: boolean;
  error?: string;
  message?: string;
  slotId?: string;
  bookingId?: string;
};

type SlotRow = {
  id: string;
  start_time: string;
  end_time: string;
  timezone: string;
  source: string;
  is_available: boolean;
};

type BookingRow = {
  id: string;
  company_id: string | null;
  conversation_id: string | null;
  slot_id: string | null;
  prospect_name: string | null;
  prospect_email: string;
  timezone: string;
  status: string;
  google_event_id: string | null;
  calendar_sync_status: string;
};

function revalidateCalendar() {
  revalidatePath("/calendar");
  revalidatePath("/conversations");
}

async function loadSlot(
  supabase: ServerSupabase,
  slotId: string
): Promise<{ slot?: SlotRow; error?: string }> {
  const { data, error } = await supabase
    .from("calendar_slots")
    .select("id,start_time,end_time,timezone,source,is_available")
    .eq("id", slotId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Slot not found." };
  return { slot: data as SlotRow };
}

async function loadBooking(
  supabase: ServerSupabase,
  bookingId: string
): Promise<{ booking?: BookingRow; error?: string }> {
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id,company_id,conversation_id,slot_id,prospect_name,prospect_email,timezone,status,google_event_id,calendar_sync_status"
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Booking not found." };
  return { booking: data as BookingRow };
}

function bookingEventInput(
  booking: BookingRow,
  slot: SlotRow,
  timezone: string
): GoogleEventInput {
  return {
    summary: `Ledgerwise call: ${booking.prospect_name || booking.prospect_email}`,
    description: [
      `Prospect: ${booking.prospect_name || "unknown"}`,
      `Email: ${booking.prospect_email}`,
      `Company: ${booking.company_id ?? "unknown"}`,
      "Managed from the Ledgerwise prototype.",
    ].join("\n"),
    startTime: slot.start_time,
    endTime: slot.end_time,
    timezone,
  };
}

async function recordGoogleSync(
  supabase: ServerSupabase,
  bookingId: string,
  result: { status: "not_configured" | "synced" | "failed"; eventId?: string },
  deleted = false
): Promise<void> {
  if (result.status === "not_configured") return;
  if (result.status === "synced") {
    await supabase
      .from("bookings")
      .update(
        deleted
          ? {
              google_event_id: null,
              calendar_sync_status: "deleted",
              calendar_synced_at: new Date().toISOString(),
            }
          : {
              ...(result.eventId ? { google_event_id: result.eventId } : {}),
              calendar_sync_status: "synced",
              calendar_synced_at: new Date().toISOString(),
            }
      )
      .eq("id", bookingId);
    return;
  }
  await supabase
    .from("bookings")
    .update({ calendar_sync_status: "failed" })
    .eq("id", bookingId);
}

async function checkSuppressed(
  supabase: ServerSupabase,
  email: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (await isSuppressed(supabase, email)) {
      return {
        ok: false,
        error: "This contact is on the permanent suppression list. A booking cannot be created or confirmed.",
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The suppression check failed. Apply the database migrations first.",
    };
  }
}

async function checkSlotFree(
  supabase: ServerSupabase,
  slot: SlotRow,
  ignoreBookingId?: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: overlappingSlots, error: slotError } = await supabase
    .from("calendar_slots")
    .select("id")
    .lt("start_time", slot.end_time)
    .gt("end_time", slot.start_time);
  if (slotError) return { ok: false, error: slotError.message };

  const slotIds = Array.from(
    new Set([slot.id, ...(overlappingSlots ?? []).map((row) => row.id)])
  );
  const { data, error } = await supabase
    .from("bookings")
    .select("id")
    .in("slot_id", slotIds)
    .in("status", [...OCCUPYING_BOOKING_STATUSES]);
  if (error) return { ok: false, error: error.message };
  const conflict = (data ?? []).find((row) => row.id !== ignoreBookingId);
  if (conflict) {
    return { ok: false, error: "That time is already held by another booking." };
  }
  return { ok: true };
}

export async function createSlot(input: {
  startTime: string;
  endTime: string;
  timezone: string;
}): Promise<CalendarActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };

  const validation = validateSlotInput(input);
  if (!validation.ok) return { ok: false, error: validation.errors.join(" ") };

  const { data, error } = await supabase
    .from("calendar_slots")
    .insert({
      start_time: input.startTime,
      end_time: input.endTime,
      timezone: input.timezone,
      source: "internal",
      external_id: null,
      is_available: true,
      fetched_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      error:
        error?.message ??
        "The slot could not be created. Apply migration 02 if the source check rejects 'internal'.",
    };
  }

  await writeAudit(supabase, {
    actorId: user.id,
    action: "calendar_slot_created",
    entityType: "calendar_slots",
    entityId: data.id,
    detail: {
      start_time: input.startTime,
      end_time: input.endTime,
      timezone: input.timezone,
      source: "internal",
    },
  });

  revalidateCalendar();
  return { ok: true, slotId: data.id, message: "Internal slot created." };
}

export async function deleteSlot(slotId: string): Promise<CalendarActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(slotId)) return { ok: false, error: "Invalid slot ID." };

  const loaded = await loadSlot(supabase, slotId);
  if (!loaded.slot) return { ok: false, error: loaded.error };

  const { data: active, error } = await supabase
    .from("bookings")
    .select("id")
    .eq("slot_id", slotId)
    .in("status", [...OCCUPYING_BOOKING_STATUSES])
    .limit(1);
  if (error) return { ok: false, error: error.message };
  if ((active ?? []).length > 0) {
    return {
      ok: false,
      error: "Cancel or reschedule the active booking before deleting this slot.",
    };
  }

  const { error: deleteError } = await supabase
    .from("calendar_slots")
    .delete()
    .eq("id", slotId);
  if (deleteError) return { ok: false, error: deleteError.message };

  await writeAudit(supabase, {
    actorId: user.id,
    action: "calendar_slot_deleted",
    entityType: "calendar_slots",
    entityId: slotId,
    detail: {
      start_time: loaded.slot.start_time,
      end_time: loaded.slot.end_time,
    },
  });

  revalidateCalendar();
  return { ok: true, slotId, message: "Slot deleted." };
}

export async function bookSlot(input: {
  slotId: string;
  companyId?: string | null;
  conversationId?: string | null;
  prospectName: string;
  prospectEmail: string;
  timezone: string;
}): Promise<CalendarActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(input.slotId)) return { ok: false, error: "Invalid slot ID." };

  let companyId = input.companyId && isUuid(input.companyId) ? input.companyId : null;
  const conversationId =
    input.conversationId && isUuid(input.conversationId) ? input.conversationId : null;
  let prospectName = input.prospectName;
  let prospectEmail = normalizeEmail(input.prospectEmail);

  if (conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id,company_id,contact_email,status")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conversation) return { ok: false, error: "Conversation not found." };
    if (conversation.status === "suppressed") {
      return {
        ok: false,
        error: "This contact is suppressed. A booking cannot be created.",
      };
    }
    companyId = companyId ?? conversation.company_id;
    if (!prospectEmail) prospectEmail = normalizeEmail(conversation.contact_email);
  }

  if (companyId) {
    const { data: company } = await supabase
      .from("companies")
      .select("name,contact_name,contact_email")
      .eq("id", companyId)
      .maybeSingle();
    if (company) {
      if (!prospectName.trim() && company.contact_name !== "unknown") {
        prospectName = company.contact_name;
      }
      if (!prospectEmail && company.contact_email) {
        prospectEmail = normalizeEmail(company.contact_email);
      }
    }
  }

  if (!isValidEmail(prospectEmail)) {
    return { ok: false, error: "A valid prospect email is required." };
  }
  const suppression = await checkSuppressed(supabase, prospectEmail);
  if (!suppression.ok) return { ok: false, error: suppression.error };

  const cleanProspectName = trimText(prospectName, 200);
  if (!cleanProspectName) {
    return { ok: false, error: "A prospect name is required." };
  }

  const validation = validateBookingInput({
    prospectName: cleanProspectName,
    prospectEmail,
    timezone: input.timezone,
  });
  if (!validation.ok) return { ok: false, error: validation.errors.join(" ") };

  const loaded = await loadSlot(supabase, input.slotId);
  if (!loaded.slot) return { ok: false, error: loaded.error };
  const { slot } = loaded;
  if (!slot.is_available) {
    return { ok: false, error: "That slot is marked unavailable." };
  }
  if (Date.parse(slot.end_time) <= Date.now()) {
    return { ok: false, error: "That slot is in the past." };
  }

  const free = await checkSlotFree(supabase, slot);
  if (!free.ok) return { ok: false, error: free.error };

  const { data: inserted, error } = await supabase
    .from("bookings")
    .insert({
      company_id: companyId,
      conversation_id: conversationId,
      slot_id: input.slotId,
      prospect_name: cleanProspectName,
      prospect_email: prospectEmail,
      timezone: input.timezone,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !inserted) {
    if (error?.code === "23505") {
      return { ok: false, error: "That slot was just taken. Refresh and choose another." };
    }
    return { ok: false, error: error?.message ?? "The booking could not be created." };
  }

  if (conversationId) {
    await supabase
      .from("conversations")
      .update({ status: "human_takeover", booking_request: false })
      .eq("id", conversationId);
  }

  await writeAudit(supabase, {
    actorId: user.id,
    action: "booking_created",
    entityType: "bookings",
    entityId: inserted.id,
    detail: {
      slot_id: input.slotId,
      company_id: companyId,
      conversation_id: conversationId,
      prospect_email: prospectEmail,
      status: "pending",
    },
  });

  const google = await syncBookingToGoogle({
    summary: `Ledgerwise call: ${cleanProspectName}`,
    description: [
      `Prospect: ${cleanProspectName}`,
      `Email: ${prospectEmail}`,
      `Company: ${companyId ?? "unknown"}`,
      "Created from the Ledgerwise prototype.",
    ].join("\n"),
    startTime: slot.start_time,
    endTime: slot.end_time,
    timezone: slot.timezone,
  });

  await recordGoogleSync(supabase, inserted.id, google);

  revalidateCalendar();
  revalidatePath(`/conversations/${conversationId ?? ""}`);
  return {
    ok: true,
    bookingId: inserted.id,
    slotId: input.slotId,
    message:
      google.status === "synced"
        ? "Booking created and synced to Google Calendar."
        : google.status === "failed"
          ? "Booking created on the internal calendar. Google Calendar sync failed."
          : "Booking created on the internal calendar.",
  };
}

export async function confirmBooking(
  bookingId: string
): Promise<CalendarActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(bookingId)) return { ok: false, error: "Invalid booking ID." };

  const loaded = await loadBooking(supabase, bookingId);
  if (!loaded.booking) return { ok: false, error: loaded.error };
  const { booking } = loaded;
  if (booking.status !== "pending" && booking.status !== "needs_human") {
    return { ok: false, error: "Only a pending or needs-human booking can be confirmed." };
  }
  const suppression = await checkSuppressed(supabase, booking.prospect_email);
  if (!suppression.ok) {
    return {
      ok: false,
      error: `${suppression.error} Cancel the booking instead.`,
    };
  }

  const { data: updated, error } = await supabase
    .from("bookings")
    .update({ status: "confirmed" })
    .eq("id", bookingId)
    .eq("status", booking.status)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return {
      ok: false,
      error: "The booking changed while you were confirming it. Refresh and try again.",
    };
  }

  let syncNote = "";
  let syncStatus = "not_attempted";
  if (!booking.google_event_id && booking.slot_id) {
    const loadedSlot = await loadSlot(supabase, booking.slot_id);
    if (loadedSlot.slot) {
      const google = await syncBookingToGoogle(
        bookingEventInput(booking, loadedSlot.slot, loadedSlot.slot.timezone)
      );
      syncStatus = google.status;
      await recordGoogleSync(supabase, bookingId, google);
      syncNote =
        google.status === "synced"
          ? " Google Calendar event created."
          : google.status === "failed"
            ? " Google Calendar sync failed; the internal booking is still confirmed."
            : "";
    }
  }

  await writeAudit(supabase, {
    actorId: user.id,
    action: "booking_confirmed",
    entityType: "bookings",
    entityId: bookingId,
    detail: {
      previous_status: booking.status,
      slot_id: booking.slot_id,
      google_sync_status: booking.google_event_id ? "already_linked" : syncStatus,
    },
  });

  revalidateCalendar();
  return { ok: true, bookingId, message: `Booking confirmed.${syncNote}` };
}

export async function cancelBooking(
  bookingId: string,
  reason: string
): Promise<CalendarActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(bookingId)) return { ok: false, error: "Invalid booking ID." };

  const cleanReason = trimText(reason, 500);
  if (!cleanReason) return { ok: false, error: "A cancellation reason is required." };

  const loaded = await loadBooking(supabase, bookingId);
  if (!loaded.booking) return { ok: false, error: loaded.error };
  const { booking } = loaded;
  if (
    booking.status !== "pending" &&
    booking.status !== "confirmed" &&
    booking.status !== "needs_human"
  ) {
    return { ok: false, error: "This booking is already cancelled or rescheduled." };
  }

  const { data: updated, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("status", booking.status)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return {
      ok: false,
      error: "The booking changed while you were cancelling it. Refresh and try again.",
    };
  }

  let syncNote = "";
  if (booking.google_event_id) {
    const google = await deleteGoogleEvent(booking.google_event_id);
    if (google.status === "not_configured") {
      await supabase
        .from("bookings")
        .update({ calendar_sync_status: "failed" })
        .eq("id", bookingId);
      syncNote =
        " The internal booking is cancelled, but the Google event could not be removed because sync is not operational.";
    } else {
      await recordGoogleSync(supabase, bookingId, google, true);
      syncNote =
        google.status === "synced"
          ? " The Google Calendar event was removed."
          : " The internal booking is cancelled, but Google Calendar deletion failed.";
    }
  }

  await writeAudit(supabase, {
    actorId: user.id,
    action: "booking_cancelled",
    entityType: "bookings",
    entityId: bookingId,
    detail: {
      previous_status: booking.status,
      slot_id: booking.slot_id,
      reason: cleanReason,
      google_event_id: booking.google_event_id,
    },
  });

  revalidateCalendar();
  return {
    ok: true,
    bookingId,
    message: `Booking cancelled. The slot is free.${syncNote}`,
  };
}

export async function rescheduleBooking(
  bookingId: string,
  newSlotId: string,
  reason: string
): Promise<CalendarActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(bookingId) || !isUuid(newSlotId)) {
    return { ok: false, error: "Invalid booking or slot ID." };
  }

  const cleanReason = trimText(reason, 500);
  if (!cleanReason) return { ok: false, error: "A reschedule reason is required." };

  const loaded = await loadBooking(supabase, bookingId);
  if (!loaded.booking) return { ok: false, error: loaded.error };
  const { booking } = loaded;
  if (
    booking.status !== "pending" &&
    booking.status !== "confirmed" &&
    booking.status !== "needs_human"
  ) {
    return { ok: false, error: "Only an active booking can be rescheduled." };
  }
  if (booking.slot_id === newSlotId) {
    return { ok: false, error: "Choose a different slot." };
  }
  const suppression = await checkSuppressed(supabase, booking.prospect_email);
  if (!suppression.ok) {
    return {
      ok: false,
      error: `${suppression.error} Cancel the booking instead.`,
    };
  }

  const loadedSlot = await loadSlot(supabase, newSlotId);
  if (!loadedSlot.slot) return { ok: false, error: loadedSlot.error };
  if (!loadedSlot.slot.is_available) {
    return { ok: false, error: "The new slot is marked unavailable." };
  }
  if (Date.parse(loadedSlot.slot.end_time) <= Date.now()) {
    return { ok: false, error: "The new slot is in the past." };
  }

  const free = await checkSlotFree(supabase, loadedSlot.slot, bookingId);
  if (!free.ok) return { ok: false, error: free.error };

  const { data: updated, error } = await supabase
    .from("bookings")
    .update({ slot_id: newSlotId, status: "pending" })
    .eq("id", bookingId)
    .eq("status", booking.status)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "That slot was just taken. Refresh and choose another." };
    }
    return { ok: false, error: error.message };
  }
  if (!updated) {
    return {
      ok: false,
      error: "The booking changed while you were rescheduling it. Refresh and try again.",
    };
  }

  const google = booking.google_event_id
    ? await updateGoogleEvent(
        booking.google_event_id,
        bookingEventInput(booking, loadedSlot.slot, loadedSlot.slot.timezone)
      )
    : await syncBookingToGoogle(
        bookingEventInput(booking, loadedSlot.slot, loadedSlot.slot.timezone)
      );
  if (google.status === "not_configured" && booking.google_event_id) {
    await supabase
      .from("bookings")
      .update({ calendar_sync_status: "failed" })
      .eq("id", bookingId);
  } else {
    await recordGoogleSync(supabase, bookingId, google);
  }
  const syncNote =
    google.status === "synced"
      ? " Google Calendar was updated."
      : google.status === "failed"
        ? " Google Calendar sync failed; the internal booking is authoritative."
        : booking.google_event_id
          ? " The Google event was not updated because sync is not operational."
          : "";

  await writeAudit(supabase, {
    actorId: user.id,
    action: "booking_rescheduled",
    entityType: "bookings",
    entityId: bookingId,
    detail: {
      old_slot_id: booking.slot_id,
      new_slot_id: newSlotId,
      previous_status: booking.status,
      reason: cleanReason,
      google_sync: google.status,
    },
  });

  revalidateCalendar();
  return {
    ok: true,
    bookingId,
    slotId: newSlotId,
    message: `Booking rescheduled. The old slot is free and the new slot is held.${syncNote}`,
  };
}
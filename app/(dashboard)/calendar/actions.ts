"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, type ServerSupabase } from "@/lib/server/auth";
import { isSuppressed } from "@/lib/suppression";
import { isValidEmail, isUuid, normalizeEmail, trimText } from "@/lib/validation";
import {
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
  const status =
    result.status === "not_configured"
      ? "not_configured"
      : deleted && result.status === "synced"
        ? "deleted"
        : result.status;
  const { error } = await supabase.rpc("record_google_calendar_sync", {
    p_booking_id: bookingId,
    p_status: status,
    p_event_id: result.status === "synced" && !deleted ? result.eventId ?? null : null,
  });
  if (error) console.error("Calendar sync metadata could not be recorded:", error.message);
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

  const { data, error } = await supabase.rpc("create_calendar_slot", {
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_timezone: input.timezone,
  });
  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "The slot could not be created.",
    };
  }
  const slotId = data as string;

  revalidateCalendar();
  return { ok: true, slotId, message: "Internal slot created." };
}

export async function deleteSlot(slotId: string): Promise<CalendarActionResult> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isUuid(slotId)) return { ok: false, error: "Invalid slot ID." };

  const loaded = await loadSlot(supabase, slotId);
  if (!loaded.slot) return { ok: false, error: loaded.error };

  const { data: deleted, error: deleteError } = await supabase.rpc(
    "delete_calendar_slot",
    { p_slot_id: slotId }
  );
  if (deleteError) return { ok: false, error: deleteError.message };
  if (!deleted) return { ok: false, error: "The slot could not be deleted." };

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
  if (input.companyId && !isUuid(input.companyId)) {
    return { ok: false, error: "Invalid company ID." };
  }
  if (input.conversationId && !isUuid(input.conversationId)) {
    return { ok: false, error: "Invalid conversation ID." };
  }

  let companyId = input.companyId ?? null;
  const conversationId = input.conversationId ?? null;
  let prospectName = input.prospectName;
  let prospectEmail = normalizeEmail(input.prospectEmail);

  if (conversationId) {
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id,company_id,contact_email,status")
      .eq("id", conversationId)
      .maybeSingle();
    if (conversationError) return { ok: false, error: conversationError.message };
    if (!conversation) return { ok: false, error: "Conversation not found." };
    if (conversation.status === "suppressed") {
      return { ok: false, error: "This contact is suppressed. A booking cannot be created." };
    }
    if (companyId && companyId !== conversation.company_id) {
      return { ok: false, error: "Company does not match the conversation." };
    }
    companyId = companyId ?? conversation.company_id;
    if (!prospectEmail) prospectEmail = normalizeEmail(conversation.contact_email);
  }

  if (companyId) {
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("name,contact_name,contact_email")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) return { ok: false, error: companyError.message };
    if (!company) return { ok: false, error: "Company not found." };
    if (!prospectName.trim() && company.contact_name !== "unknown") {
      prospectName = company.contact_name;
    }
    if (!prospectEmail && company.contact_email) {
      prospectEmail = normalizeEmail(company.contact_email);
    }
  }

  if (!isValidEmail(prospectEmail)) {
    return { ok: false, error: "A valid prospect email is required." };
  }
  const suppression = await checkSuppressed(supabase, prospectEmail);
  if (!suppression.ok) return { ok: false, error: suppression.error };

  const cleanProspectName = trimText(prospectName, 200);
  if (!cleanProspectName) return { ok: false, error: "A prospect name is required." };

  const validation = validateBookingInput({
    prospectName: cleanProspectName,
    prospectEmail,
    timezone: input.timezone,
  });
  if (!validation.ok) return { ok: false, error: validation.errors.join(" ") };

  const loaded = await loadSlot(supabase, input.slotId);
  if (!loaded.slot) return { ok: false, error: loaded.error };
  const slot = loaded.slot;
  if (!slot.is_available) return { ok: false, error: "That slot is marked unavailable." };
  if (Date.parse(slot.end_time) <= Date.now()) {
    return { ok: false, error: "That slot is in the past." };
  }

  // The RPC repeats the critical checks under the shared database transaction lock.
  const { data: createdBookingId, error } = await supabase.rpc("book_slot", {
    p_slot_id: input.slotId,
    p_company_id: companyId,
    p_conversation_id: conversationId,
    p_prospect_name: cleanProspectName,
    p_prospect_email: prospectEmail,
    p_timezone: input.timezone,
  });
  if (error || !createdBookingId) {
    return { ok: false, error: error?.message ?? "The booking could not be created." };
  }
  const bookingId = createdBookingId as string;

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
  await recordGoogleSync(supabase, bookingId, google);

  revalidateCalendar();
  if (conversationId) revalidatePath(`/conversations/${conversationId}`);
  return {
    ok: true,
    bookingId,
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

  const { data: updated, error } = await supabase.rpc("confirm_booking", {
    p_booking_id: bookingId,
  });
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "The booking could not be confirmed." };

  let syncNote = "";
  if (!booking.google_event_id && booking.slot_id) {
    const loadedSlot = await loadSlot(supabase, booking.slot_id);
    if (loadedSlot.slot) {
      const google = await syncBookingToGoogle(
        bookingEventInput(booking, loadedSlot.slot, loadedSlot.slot.timezone)
      );
      await recordGoogleSync(supabase, bookingId, google);
      syncNote =
        google.status === "synced"
          ? " Google Calendar event created."
          : google.status === "failed"
            ? " Google Calendar sync failed; the internal booking is still confirmed."
            : "";
    }
  }

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

  const { data: updated, error } = await supabase.rpc("cancel_booking", {
    p_booking_id: bookingId,
    p_reason: cleanReason,
  });
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "The booking could not be cancelled." };

  let syncNote = "";
  if (booking.google_event_id) {
    const google = await deleteGoogleEvent(booking.google_event_id);
    if (google.status === "not_configured") {
      await recordGoogleSync(supabase, bookingId, { status: "failed" });
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

  const { data: updated, error } = await supabase.rpc("reschedule_booking", {
    p_booking_id: bookingId,
    p_new_slot_id: newSlotId,
    p_reason: cleanReason,
  });
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "The booking could not be rescheduled." };

  const google = booking.google_event_id
    ? await updateGoogleEvent(
        booking.google_event_id,
        bookingEventInput(booking, loadedSlot.slot, loadedSlot.slot.timezone)
      )
    : await syncBookingToGoogle(
        bookingEventInput(booking, loadedSlot.slot, loadedSlot.slot.timezone)
      );
  if (google.status === "not_configured" && booking.google_event_id) {
    await recordGoogleSync(supabase, bookingId, { status: "failed" });
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



  revalidateCalendar();
  return {
    ok: true,
    bookingId,
    slotId: newSlotId,
    message: `Booking rescheduled. The old slot is free and the new slot is held.${syncNote}`,
  };
}
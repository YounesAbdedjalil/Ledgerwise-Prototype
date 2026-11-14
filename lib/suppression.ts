import type { ServerSupabase } from "./server/auth";
import { isValidEmail, normalizeEmail } from "./validation";

export type SuppressionRow = {
  id: string;
  email: string;
  reason: string;
  source_message_id: string | null;
  created_at: string;
};

export type SuppressResult =
  | { ok: true; row: SuppressionRow }
  | { ok: false; error: string };

export function suppressionErrorMessage(code: string): string {
  switch (code) {
    case "not_authenticated":
      return "You must be signed in to update the suppression list.";
    case "invalid_email":
      return "The contact email is not valid.";
    default:
      return "The contact could not be added to the suppression list.";
  }
}

export async function isSuppressed(
  supabase: ServerSupabase,
  email: string
): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const { data, error } = await supabase.rpc("is_suppressed", {
    p_email: normalized,
  });
  if (error) throw new Error(`Suppression check failed: ${error.message}`);
  return Boolean(data);
}

export async function suppressContact(
  supabase: ServerSupabase,
  input: {
    email: string;
    reason: string;
    sourceMessageId?: string | null;
  }
): Promise<SuppressResult> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    return { ok: false, error: suppressionErrorMessage("invalid_email") };
  }

  const { data, error } = await supabase.rpc("suppress_contact", {
    p_email: email,
    p_reason: input.reason,
    p_source_message_id: input.sourceMessageId ?? null,
  });

  if (error) {
    return { ok: false, error: suppressionErrorMessage(error.message) };
  }

  const row = (Array.isArray(data) ? data[0] : data) as SuppressionRow | null;
  if (!row) return { ok: false, error: "The contact could not be suppressed." };
  return { ok: true, row };
}
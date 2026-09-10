"use server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadLatestUnreadNotifications, loadUnreadNotificationCount, type UnreadNotification } from "@/lib/notifications/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type NotificationActionResult = { ok: true } | { ok: false; message: string };
export type NotificationCountResult = { ok: true; count: number } | { ok: false; message: string };
export type NotificationListResult = { ok: true; notifications: UnreadNotification[] } | { ok: false; message: string };

async function recipientId() {
  const current = await getCurrentProfile();
  return current?.profile && ["ADMIN", "STUDENT"].includes(current.profile.role) ? current.user.id : null;
}

export async function getUnreadNotificationCount(): Promise<NotificationCountResult> {
  const userId = await recipientId();
  if (!userId) return { ok: false, message: "Уведомления недоступны." };
  try {
    return { ok: true, count: await loadUnreadNotificationCount(userId) };
  } catch (error) {
    console.error("NOTIFICATIONS_COUNT_LOAD", notificationError(error));
    return { ok: false, message: "Не удалось загрузить количество уведомлений." };
  }
}

export async function getLatestUnreadNotifications(): Promise<NotificationListResult> {
  const userId = await recipientId();
  if (!userId) return { ok: false, message: "Уведомления недоступны." };
  try {
    return { ok: true, notifications: await loadLatestUnreadNotifications(userId) };
  } catch (error) {
    console.error("NOTIFICATIONS_LIST_LOAD", notificationError(error));
    return { ok: false, message: "Не удалось загрузить уведомления." };
  }
}

export async function markNotificationRead(notificationId: string): Promise<NotificationActionResult> {
  const userId = await recipientId();
  if (!userId || !uuid.test(notificationId)) return { ok: false, message: "Уведомление недоступно." };
  const result = await createAdminClient().rpc("mark_notification_read_v1", { p_recipient_user_id: userId, p_notification_id: notificationId });
  if (result.error || result.data !== true) {
    if (result.error) console.error("NOTIFICATION_MARK_READ", { code: result.error.code, message: result.error.message });
    return { ok: false, message: "Не удалось отметить уведомление." };
  }
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  const userId = await recipientId();
  if (!userId) return { ok: false, message: "Уведомления недоступны." };
  const result = await createAdminClient().rpc("mark_all_notifications_read_v1", { p_recipient_user_id: userId });
  if (result.error) {
    console.error("NOTIFICATIONS_MARK_ALL_READ", { code: result.error.code, message: result.error.message });
    return { ok: false, message: "Не удалось прочитать все уведомления." };
  }
  return { ok: true };
}

function notificationError(error: unknown) {
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; message?: unknown };
    return { code: typeof value.code === "string" ? value.code : "", message: typeof value.message === "string" ? value.message : "Unknown notification error" };
  }
  return { code: "", message: "Unknown notification error" };
}

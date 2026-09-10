import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export const notificationTypes = [
  "TEST_ASSIGNED",
  "MATERIAL_ASSIGNED",
  "TRAINER_ASSIGNED",
  "TRAINER_RESTARTED",
  "TEST_COMPLETED",
  "TRAINER_COMPLETED",
  "SUPPORT_MESSAGE_RECEIVED",
] as const;

export type NotificationType = (typeof notificationTypes)[number];
export type UnreadNotification = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  href: string;
  createdAt: string;
};

export async function loadUnreadNotificationCount(recipientUserId: string) {
  const result = await createAdminClient().from("notifications").select("id", { count: "exact", head: true }).eq("recipient_user_id", recipientUserId).is("read_at", null);
  if (result.error) throw result.error;
  return result.count ?? 0;
}

export async function loadLatestUnreadNotifications(recipientUserId: string) {
  const result = await createAdminClient().from("notifications").select("id,type,title,message,href,created_at").eq("recipient_user_id", recipientUserId).is("read_at", null).order("created_at", { ascending: false }).limit(20);
  if (result.error) throw result.error;
  return (result.data ?? []).map((item) => ({
      id: item.id,
      type: item.type as NotificationType,
      title: item.title,
      message: item.message,
      href: item.href,
      createdAt: item.created_at,
    }));
}

import { readJsonFile, writeJsonAtomic } from "./storageJson";
import webpush, { PushSubscription, WebPushError } from "web-push";
import { PanelUserRole } from "./shared/types";

type StoredSubscription = PushSubscription & {
  email: string;
  role: PanelUserRole;
  createdAt: string;
  updatedAt: string;
};

type StoredPushData = {
  vapid: { publicKey: string; privateKey: string };
  subscriptions: StoredSubscription[];
};

export type ImportantPushNotification = {
  title: string;
  body: string;
  tag: string;
  url?: string;
  requireInteraction?: boolean;
};

export class PushNotificationStore {
  private data: StoredPushData;

  constructor(private readonly filePath: string, configuredKeys?: { publicKey?: string; privateKey?: string }, subject = "mailto:admin@botrotas.local") {
    this.data = this.load(configuredKeys);
    webpush.setVapidDetails(subject, this.data.vapid.publicKey, this.data.vapid.privateKey);
  }

  publicKey() {
    return this.data.vapid.publicKey;
  }

  upsert(email: string, role: PanelUserRole, subscription: PushSubscription) {
    if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new Error("Assinatura de notificação inválida.");
    }
    let endpoint: URL;
    try { endpoint = new URL(subscription.endpoint); } catch { throw new Error("Assinatura de notificação inválida."); }
    const providers = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com", "notify.windows.com"];
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || (endpoint.port && endpoint.port !== "443") || !providers.some((host) => endpoint.hostname === host || endpoint.hostname.endsWith(`.${host}`))) {
      throw new Error("Servidor de notificação não autorizado.");
    }
    if (subscription.endpoint.length > 4096 || typeof subscription.keys.p256dh !== "string" || subscription.keys.p256dh.length > 256 || typeof subscription.keys.auth !== "string" || subscription.keys.auth.length > 256) throw new Error("Assinatura de notificação inválida.");
    const normalizedEmail = email.trim().toLowerCase();
    const now = new Date().toISOString();
    const existing = this.data.subscriptions.find((item) => item.endpoint === subscription.endpoint);
    const stored: StoredSubscription = {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      keys: subscription.keys,
      email: normalizedEmail,
      role,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    this.data.subscriptions = [stored, ...this.data.subscriptions.filter((item) => item.endpoint !== stored.endpoint && item.email === normalizedEmail).slice(0, 9), ...this.data.subscriptions.filter((item) => item.endpoint !== stored.endpoint && item.email !== normalizedEmail)];
    this.save();
    return stored;
  }

  remove(endpoint: string, email?: string) {
    const normalizedEmail = email?.trim().toLowerCase();
    const before = this.data.subscriptions.length;
    this.data.subscriptions = this.data.subscriptions.filter((item) => item.endpoint !== endpoint || (normalizedEmail && item.email !== normalizedEmail));
    if (this.data.subscriptions.length !== before) this.save();
  }

  async sendToEmails(emails: string[], notification: ImportantPushNotification) {
    const wanted = new Set(emails.map((email) => email.trim().toLowerCase()));
    return this.send(this.data.subscriptions.filter((item) => wanted.has(item.email)), notification);
  }

  async sendToRole(role: PanelUserRole, notification: ImportantPushNotification) {
    return this.send(this.data.subscriptions.filter((item) => item.role === role), notification);
  }

  private async send(subscriptions: StoredSubscription[], notification: ImportantPushNotification) {
    if (!subscriptions.length) return { sent: 0, failed: 0 };
    let sent = 0;
    let failed = 0;
    const expired = new Set<string>();
    const payload = JSON.stringify({
      ...notification,
      icon: "/bot-icon-512.png",
      badge: "/bot-icon-maskable-512.png"
    });

    for (let offset = 0; offset < subscriptions.length; offset += 8) {
    await Promise.all(subscriptions.slice(offset, offset + 8).map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 60 * 60, urgency: "high", timeout: 10_000 });
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode = (error as WebPushError)?.statusCode;
        if (statusCode === 404 || statusCode === 410) expired.add(subscription.endpoint);
      }
    }));
    }

    if (expired.size) {
      this.data.subscriptions = this.data.subscriptions.filter((item) => !expired.has(item.endpoint));
      this.save();
    }
    return { sent, failed };
  }

  private load(configuredKeys?: { publicKey?: string; privateKey?: string }): StoredPushData {
    const stored = readJsonFile<StoredPushData | undefined>(this.filePath, () => undefined,
      (value) => Boolean(value && typeof value === "object" && "vapid" in value && "subscriptions" in value && Array.isArray(value.subscriptions)));
    if (stored) return stored;
    const hasConfiguredKeys = Boolean(configuredKeys?.publicKey && configuredKeys?.privateKey);
    const vapid = hasConfiguredKeys
      ? { publicKey: configuredKeys!.publicKey!, privateKey: configuredKeys!.privateKey! }
      : webpush.generateVAPIDKeys();
    const data = { vapid, subscriptions: [] };
    writeJsonAtomic(this.filePath, data);
    return data;
  }

  private save() {
    writeJsonAtomic(this.filePath, this.data);
  }
}

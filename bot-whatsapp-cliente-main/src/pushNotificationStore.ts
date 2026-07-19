import fs from "fs";
import path from "path";
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
    this.data.subscriptions = [stored, ...this.data.subscriptions.filter((item) => item.endpoint !== stored.endpoint)];
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

    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 60 * 60, urgency: "high" });
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode = (error as WebPushError)?.statusCode;
        if (statusCode === 404 || statusCode === 410) expired.add(subscription.endpoint);
      }
    }));

    if (expired.size) {
      this.data.subscriptions = this.data.subscriptions.filter((item) => !expired.has(item.endpoint));
      this.save();
    }
    return { sent, failed };
  }

  private load(configuredKeys?: { publicKey?: string; privateKey?: string }): StoredPushData {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      if (parsed?.vapid?.publicKey && parsed?.vapid?.privateKey && Array.isArray(parsed.subscriptions)) return parsed;
    } catch {
      // Cria a configuração na primeira execução.
    }
    const hasConfiguredKeys = Boolean(configuredKeys?.publicKey && configuredKeys?.privateKey);
    const vapid = hasConfiguredKeys
      ? { publicKey: configuredKeys!.publicKey!, privateKey: configuredKeys!.privateKey! }
      : webpush.generateVAPIDKeys();
    const data = { vapid, subscriptions: [] };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    return data;
  }

  private save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2));
    fs.renameSync(tempPath, this.filePath);
  }
}

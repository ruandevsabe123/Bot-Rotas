import fs from "fs";
import path from "path";
import { SupportMessage } from "./shared/types";

const MAX_MESSAGES = 300;

export class SupportMessageStore {
  constructor(private readonly filePath: string) {}

  all() {
    return this.load();
  }

  create(input: { email: string; message: string; userAgent?: string }) {
    const email = input.email.trim().toLowerCase();
    const message = input.message.trim();
    if (!email) throw new Error("Informe seu email.");
    if (!message) throw new Error("Escreva uma mensagem para o suporte.");

    const supportMessage: SupportMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      email,
      message,
      userAgent: input.userAgent,
      createdAt: new Date().toISOString(),
      read: false
    };

    this.save([supportMessage, ...this.load()].slice(0, MAX_MESSAGES));
    return supportMessage;
  }

  markRead(id: string) {
    const now = new Date().toISOString();
    this.save(
      this.load().map((message) =>
        message.id === id
          ? {
              ...message,
              read: true,
              readAt: message.readAt || now
            }
          : message
      )
    );
  }

  private load(): SupportMessage[] {
    if (!fs.existsSync(this.filePath)) return [];

    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      return Array.isArray(data) ? data.map((item) => this.normalize(item)).filter(Boolean) as SupportMessage[] : [];
    } catch {
      return [];
    }
  }

  private save(messages: SupportMessage[]) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(messages, null, 2));
  }

  private normalize(input: any): SupportMessage | undefined {
    if (!input || typeof input.id !== "string") return undefined;
    return {
      id: input.id,
      email: typeof input.email === "string" ? input.email : "",
      message: typeof input.message === "string" ? input.message : "",
      createdAt: typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString(),
      read: Boolean(input.read),
      readAt: typeof input.readAt === "string" ? input.readAt : undefined,
      userAgent: typeof input.userAgent === "string" ? input.userAgent : undefined
    };
  }
}

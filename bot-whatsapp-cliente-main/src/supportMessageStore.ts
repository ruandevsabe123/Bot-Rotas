import { readJsonFile, writeJsonAtomic } from "./storageJson";
import { HttpError, validateEmail } from "./httpSafety";
import { SupportMessage } from "./shared/types";

const MAX_MESSAGES = 300;

export class SupportMessageStore {
  constructor(private readonly filePath: string) {}

  all() {
    return this.load();
  }

  create(input: { email: string; message: string; userAgent?: string }) {
    const email = validateEmail(input.email);
    const message = input.message.trim();
    if (!email) throw new Error("Informe seu email.");
    if (!message) throw new Error("Escreva uma mensagem para o suporte.");
    if (message.length > 5000) throw new HttpError(400, "A mensagem deve ter até 5000 caracteres.");

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

  clear(email?: string) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      this.save([]);
      return;
    }
    this.save(this.load().filter((message) => message.email !== normalizedEmail));
  }

  private load(): SupportMessage[] {
    return readJsonFile<unknown[]>(this.filePath, () => [], Array.isArray)
      .map((item) => this.normalize(item)).filter(Boolean) as SupportMessage[];
  }

  private save(messages: SupportMessage[]) {
    writeJsonAtomic(this.filePath, messages);
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

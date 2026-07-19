import { getPushConfig, savePushSubscription } from "./api";

export function supportsWebPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function enableWebPushNotifications() {
  if (!supportsWebPush()) throw new Error("Este navegador não suporta notificações em segundo plano.");
  if (!window.isSecureContext) throw new Error("As notificações exigem acesso HTTPS ao painel.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permissão de notificação não liberada no navegador.");

  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await getPushConfig();
  if (!publicKey) throw new Error("Servidor de notificações não configurado.");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });
  await savePushSubscription(subscription.toJSON());
  return subscription;
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

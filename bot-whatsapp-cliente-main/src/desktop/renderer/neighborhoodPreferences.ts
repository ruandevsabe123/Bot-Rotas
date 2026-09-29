import { BotConfig, MonitoredRoute } from "../../shared/types";

function preferenceKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

/** Preserve the client's order and distinguish equal neighborhood names in different cities. */
export function normalizeNeighborhoodPreferences(routes: MonitoredRoute[]): MonitoredRoute[] {
  const seen = new Set<string>();
  return routes
    .map((route) => ({
      cidade: String(route?.cidade || "").trim().replace(/\s+/g, " "),
      bairro: String(route?.bairro || "").trim().replace(/\s+/g, " "),
      enabled: route?.enabled !== false
    }))
    .filter((route) => {
      if (!route.bairro) return false;
      const key = JSON.stringify([preferenceKey(route.cidade), preferenceKey(route.bairro)]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function getNeighborhoodPreferences(config: Pick<BotConfig, "rotasMonitoradas" | "rotasMonitoradasDetalhadas">): MonitoredRoute[] {
  const detailed = normalizeNeighborhoodPreferences(config.rotasMonitoradasDetalhadas || []);
  return detailed.length ? detailed : normalizeNeighborhoodPreferences((config.rotasMonitoradas || []).map((bairro) => ({ cidade: "", bairro, enabled: true })));
}

export function getEnabledNeighborhoodPreferences(routes: MonitoredRoute[]): MonitoredRoute[] {
  return routes.filter((route) => route.enabled !== false);
}

export function moveNeighborhoodPreference(routes: MonitoredRoute[], fromIndex: number, toIndex: number): MonitoredRoute[] {
  if (fromIndex < 0 || fromIndex >= routes.length || toIndex < 0 || toIndex >= routes.length) return routes;
  const next = [...routes];
  const [route] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, route);
  return next;
}

export function neighborhoodPreferenceLabel(route: MonitoredRoute) {
  return route.cidade ? `${route.bairro} (${route.cidade})` : route.bairro;
}

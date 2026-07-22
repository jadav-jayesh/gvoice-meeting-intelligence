import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/Icon";
import {
  disconnectCalendar,
  getCalendarConnections,
  startCalendarConnect,
  type CalendarConnection,
  type CalendarConnectionsResponse,
  type CalendarProvider
} from "../lib/api";

const PROVIDER_META: Record<CalendarProvider, { label: string; blurb: string; logo: string }> = {
  google: { label: "Google Calendar", blurb: "Auto-join Meet, Zoom & Teams links from your Google Calendar.", logo: "/logo-gcal.svg" },
  microsoft: { label: "Microsoft Calendar", blurb: "Auto-join Teams, Zoom & Meet links from your Outlook calendar.", logo: "/logo-outlook.svg" }
};

// Maps the ?status= value the OAuth callback redirects back with to a banner.
const STATUS_MESSAGES: Record<string, { kind: "ok" | "err"; text: string }> = {
  connected: { kind: "ok", text: "Calendar connected. We'll auto-join your upcoming meetings." },
  error: { kind: "err", text: "Couldn't connect that calendar. Please try again." },
  no_refresh_token: { kind: "err", text: "Connection didn't grant offline access. Please reconnect and approve all prompts." }
};

export function CalendarsPage() {
  const [data, setData] = useState<CalendarConnectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<CalendarProvider | null>(null);
  const [params, setParams] = useSearchParams();

  const banner = params.get("status") ? STATUS_MESSAGES[params.get("status") as string] : undefined;

  async function load() {
    setLoading(true);
    try {
      setData(await getCalendarConnections());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Clear the OAuth result query params after showing the banner once.
  useEffect(() => {
    if (!params.get("status")) return;
    const timer = setTimeout(() => {
      params.delete("status");
      params.delete("provider");
      setParams(params, { replace: true });
    }, 6000);
    return () => clearTimeout(timer);
  }, [params, setParams]);

  async function connect(provider: CalendarProvider) {
    setBusy(provider);
    try {
      const { url } = await startCalendarConnect(provider);
      window.location.href = url; // full-page navigation to the provider consent screen
    } catch {
      setBusy(null);
    }
  }

  async function disconnect(provider: CalendarProvider) {
    setBusy(provider);
    try {
      await disconnectCalendar(provider);
      await load();
    } finally {
      setBusy(null);
    }
  }

  const byProvider = (provider: CalendarProvider): CalendarConnection | undefined =>
    data?.connections.find((c) => c.provider === provider);

  return (
    <div className="space-y-4">
      <p className="text-[13.5px] text-inkMute">
        Connect a calendar and gVoice will automatically join and record your meetings — no need to paste links.
      </p>

      {banner && (
        <div
          role="status"
          className={
            banner.kind === "ok"
              ? "flex items-center gap-2 rounded-lg border border-positive/30 bg-positive/5 px-3 py-2.5 text-[12.5px] text-positive"
              : "flex items-center gap-2 rounded-lg border border-negative/30 bg-negative/5 px-3 py-2.5 text-[12.5px] text-negative"
          }
        >
          {banner.kind === "ok" ? <Icon.CheckCircle size={14} /> : <Icon.AlertCircle size={14} />}
          {banner.text}
        </div>
      )}

      {/* Microsoft first: it works for everyone, while Google is still test-user
          gated (unverified sensitive scope) — lead with the flow that succeeds. */}
      {(["microsoft", "google"] as CalendarProvider[]).map((provider) => {
        const meta = PROVIDER_META[provider];
        const connection = byProvider(provider);
        const available = data?.available[provider] ?? false;
        const isBusy = busy === provider;

        return (
          <Card key={provider} padded>
            <div className="flex items-start gap-4">
              <div className="grid place-items-center w-10 h-10 rounded-lg border border-line bg-surface shrink-0">
                <img src={meta.logo} alt="" aria-hidden className="h-[22px] w-[22px] object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-medium text-ink">{meta.label}</p>
                <p className="text-[12.5px] text-inkMute mt-0.5">{meta.blurb}</p>

                {connection && (
                  <div className="mt-2 flex items-center gap-2 text-[12px]">
                    <span className="inline-flex items-center gap-1 rounded-full border border-positive/30 bg-positive/5 px-2 py-0.5 text-positive">
                      <Icon.CheckCircle size={12} /> Connected
                    </span>
                    {connection.accountEmail && <span className="text-inkMute truncate">{connection.accountEmail}</span>}
                  </div>
                )}
                {!available && !connection && (
                  <p className="mt-2 text-[12px] text-inkFaint">Not configured on the server yet.</p>
                )}
              </div>

              <div className="shrink-0">
                {connection ? (
                  <Button variant="ghost" size="sm" loading={isBusy} onClick={() => disconnect(provider)}>
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={isBusy}
                    disabled={!available || loading}
                    onClick={() => connect(provider)}
                  >
                    Connect
                  </Button>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import {
  adminGetSettings,
  adminUpdateSetting,
  adminRevertSetting,
  adminTestSetting,
  type AdminSetting,
  type AdminSettingTestResult
} from "../../lib/api";

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<AdminSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminGetSettings()
      .then((r) => !cancelled && setSettings(r.settings))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load settings"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, AdminSetting[]>();
    for (const s of settings) {
      const arr = map.get(s.group) ?? [];
      arr.push(s);
      map.set(s.group, arr);
    }
    return [...map.entries()];
  }, [settings]);

  return (
    <div className="page-shell py-10 lg:py-14 page-enter">
      <header className="mb-8 lg:mb-10">
        <p className="text-[11px] uppercase tracking-widest text-inkMute mb-2">Admin</p>
        <h1 className="text-[34px] lg:text-[40px] font-semibold tracking-tightest text-ink leading-none">Settings</h1>
        <p className="text-inkMute text-[15px] mt-3 max-w-2xl leading-relaxed">
          Provider API keys and bot behaviour. Changes apply to the next meeting — no restart needed.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-negative/20 bg-negative/5 px-4 py-3 text-[13px] text-negative">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-0 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-line bg-surfaceHi/40">
                <Skeleton className="h-4 w-28" />
              </div>
              <div className="divide-y divide-line">
                {[0, 1].map((r) => (
                  <div key={r} className="flex items-center justify-between gap-6 px-5 py-4">
                    <div className="flex-1">
                      <Skeleton className="h-4 w-40 mb-2" />
                      <Skeleton className="h-3 w-52" />
                    </div>
                    <Skeleton className="h-9 w-32" />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
          {groups.map(([group, items]) => (
            <Card key={group} className="p-0 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line bg-surfaceHi/40">
                <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">{group}</h2>
                <span className="text-[11px] uppercase tracking-wider text-inkFaint">
                  {items.length} setting{items.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="divide-y divide-line">
                {items.map((s) => (
                  <SettingRow key={s.key} setting={s} onChange={(next) => setSettings(next)} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingRow({ setting, onChange }: { setting: AdminSetting; onChange: (s: AdminSetting[]) => void }) {
  const [value, setValue] = useState<string>(setting.isSecret ? "" : (setting.value ?? ""));
  const [password, setPassword] = useState("");
  const [editingSecret, setEditingSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AdminSettingTestResult | null>(null);

  const cleanErr = (e: unknown) =>
    e instanceof Error ? e.message.replace(/^\d+ [^—]*— ?/, "") : "Failed";

  // Test the typed candidate if there is one, otherwise the stored/resolved value.
  async function runTest(candidate?: string) {
    setTesting(true);
    setTestResult(null);
    setErr(null);
    try {
      setTestResult(await adminTestSetting(setting.key, candidate));
    } catch (e) {
      setTestResult({ ok: false, status: "error", detail: cleanErr(e) });
    } finally {
      setTesting(false);
    }
  }

  // Auto-check credit/connection status once on load for testable, set keys.
  useEffect(() => {
    if (setting.testable && setting.isSet) void runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chip = (() => {
    if (!setting.testable || !setting.isSet) return null;
    if (testing && !testResult) return { label: "Checking…", tone: "neutral" as const };
    if (!testResult) return null;
    const map = {
      ok: { label: "Connected", tone: "positive" as const },
      no_credits: { label: "Out of credits", tone: "warn" as const },
      unauthorized: { label: "Key invalid", tone: "negative" as const },
      error: { label: "Check failed", tone: "neutral" as const }
    };
    return map[testResult.status] ?? map.error;
  })();

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await adminUpdateSetting(setting.key, value, setting.isSecret ? password : undefined);
      onChange(r.settings);
      setMsg("Saved");
      setPassword("");
      if (setting.isSecret) {
        setValue("");
        setEditingSecret(false);
      }
    } catch (e) {
      setErr(cleanErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function revert() {
    if (!window.confirm(`Revert "${setting.label}" to the default (.env) value?`)) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await adminRevertSetting(setting.key);
      onChange(r.settings);
      setMsg("Reverted to default");
      setValue("");
      setEditingSecret(false);
    } catch (e) {
      setErr(cleanErr(e));
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "h-9 px-3 rounded-lg border border-line bg-bg text-[13px] text-ink placeholder:text-inkMute focus-ring";

  return (
    <div className="px-5 py-4 flex items-center justify-between gap-x-6 gap-y-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13.5px] font-medium text-ink">{setting.label}</span>
          <Badge tone={setting.source === "db" ? "brand" : "neutral"}>
            {setting.source === "db" ? "Custom" : "Default"}
          </Badge>
        </div>
        {setting.help && <p className="text-[12px] text-inkMute mt-0.5">{setting.help}</p>}
        <code className="text-[10.5px] text-inkFaint break-all">{setting.key}</code>
      </div>

      <div className="flex flex-col items-end gap-2 shrink-0">
          {/* Current value / control */}
          {setting.isSecret ? (
            <div className="flex flex-col items-end gap-2">
              <span className="text-[12.5px] text-inkSoft flex items-center gap-2">
                {setting.isSet ? (
                  <>
                    Set · <span className="font-mono">••••{setting.last4}</span>
                  </>
                ) : (
                  <span className="text-inkFaint">Not set</span>
                )}
                {chip && (
                  <span title={testResult?.detail}>
                    <Badge tone={chip.tone}>{chip.label}</Badge>
                  </span>
                )}
              </span>
              {!editingSecret ? (
                <div className="flex items-center gap-2">
                  {setting.testable && setting.isSet && (
                    <Button variant="ghost" disabled={testing} onClick={() => runTest()}>
                      {testing ? "Testing…" : "Test connection"}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => setEditingSecret(true)}>
                    {setting.isSet ? "Replace key" : "Set key"}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-end gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="New key value"
                    className={`${inputClass} w-64`}
                  />
                  <input
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Confirm your password"
                    className={`${inputClass} w-64`}
                  />
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={() => { setEditingSecret(false); setValue(""); setPassword(""); setErr(null); setTestResult(null); }}>
                      Cancel
                    </Button>
                    {setting.testable && (
                      <Button variant="secondary" disabled={testing || !value} onClick={() => runTest(value)}>
                        {testing ? "Testing…" : "Test"}
                      </Button>
                    )}
                    <Button variant="primary" disabled={busy || !value || !password} onClick={save}>
                      {busy ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : setting.type === "enum" ? (
            <div className="flex items-center gap-2">
              <select value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} w-44`}>
                {setting.options?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <Button variant="primary" disabled={busy || value === setting.value} onClick={save}>
                {busy ? "…" : "Save"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type={setting.type === "number" ? "number" : "text"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={`${inputClass} w-44 text-right tabular-nums`}
              />
              <Button variant="primary" disabled={busy || value === (setting.value ?? "")} onClick={save}>
                {busy ? "…" : "Save"}
              </Button>
            </div>
          )}

          {setting.source === "db" && (
            <button
              type="button"
              onClick={revert}
              disabled={busy}
              className="text-[11.5px] text-inkMute hover:text-ink focus-ring rounded"
            >
              Revert to default
            </button>
          )}
          {testResult && !testResult.ok && editingSecret && (
            <span className="text-[11.5px] max-w-64 text-right text-negative">✕ {testResult.detail}</span>
          )}
          {msg && <span className="text-[11.5px] text-positive">{msg}</span>}
          {err && <span className="text-[11.5px] text-negative max-w-64 text-right">{err}</span>}
        </div>
    </div>
  );
}

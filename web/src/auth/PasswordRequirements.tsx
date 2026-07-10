import { passwordChecks } from "./useField";

interface Props {
  value: string;
}

const items: Array<{ key: keyof ReturnType<typeof passwordChecks>; label: string }> = [
  { key: "length", label: "8+ characters" },
  { key: "upper", label: "Uppercase letter" },
  { key: "lower", label: "Lowercase letter" },
  { key: "digit", label: "Number" },
  { key: "special", label: "Special character" }
];

export function PasswordRequirements({ value }: Props) {
  const checks = passwordChecks(value);
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px] text-inkMute">
      {items.map(({ key, label }) => {
        const ok = checks[key];
        return (
          <li
            key={key}
            className={`flex items-center gap-1.5 transition-colors duration-150 ${
              ok ? "text-positive" : "text-inkMute"
            }`}
          >
            <span
              aria-hidden
              className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full shrink-0 border ${
                ok ? "bg-positive/15 border-positive/40" : "bg-transparent border-line"
              }`}
            >
              {ok ? (
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path
                    d="M2 5l2 2 4 -4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <span className="w-1 h-1 rounded-full bg-inkFaint/60" />
              )}
            </span>
            <span>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

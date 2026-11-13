import { useEffect, useRef, useState } from "react";

interface MultiSelectProps {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

export function MultiSelect({ label, options, value, onChange, placeholder = "All" }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);

  const summary =
    value.length === 0 ? placeholder : value.length === 1 ? value[0] : `${value.length} selected`;

  return (
    <div className="field ms-wrapper" ref={ref}>
      {label}
      <button className="ms-trigger" type="button" onClick={() => setOpen((o) => !o)}>
        <span className={value.length === 0 ? "ms-placeholder" : "ms-summary"}>{summary}</span>
        <span className="ms-chevron">{open ? "▲" : "▼"}</span>
      </button>
      {open && options.length > 0 && (
        <div className="ms-dropdown">
          {value.length > 0 && (
            <button className="ms-clear" type="button" onClick={() => onChange([])}>
              Clear
            </button>
          )}
          {options.map((opt) => (
            <label key={opt} className="ms-option">
              {opt}
              <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

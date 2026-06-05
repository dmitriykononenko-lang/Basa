// Тонкие линейные иконки в стиле референса (stroke 1.6, 20px)
type P = { className?: string };
const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const IconDashboard = (p: P) => (
  <svg {...base} className={p.className}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

export const IconTransactions = (p: P) => (
  <svg {...base} className={p.className}>
    <path d="M7 7h13l-3-3" />
    <path d="M17 17H4l3 3" />
  </svg>
);

export const IconAccounts = (p: P) => (
  <svg {...base} className={p.className}>
    <rect x="3" y="6" width="18" height="13" rx="2.5" />
    <path d="M3 10h18" />
    <path d="M16 14h2" />
  </svg>
);

export const IconCounterparties = (p: P) => (
  <svg {...base} className={p.className}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
    <path d="M16 11a3 3 0 0 0 0-6" />
    <path d="M18 20c0-2.2-.9-3.8-2.3-4.6" />
  </svg>
);

export const IconProjects = (p: P) => (
  <svg {...base} className={p.className}>
    <path d="M3 7.5 12 3l9 4.5-9 4.5z" />
    <path d="M3 7.5V16l9 4.5 9-4.5V7.5" />
    <path d="M12 12v8.5" />
  </svg>
);

export const IconDebts = (p: P) => (
  <svg {...base} className={p.className}>
    <path d="M12 3v18" />
    <path d="M6 7 3 12h6z" />
    <path d="M18 7l-3 5h6z" />
    <path d="M7 21h10" />
  </svg>
);

export const IconBudgets = (p: P) => (
  <svg {...base} className={p.className}>
    <path d="M12 3a9 9 0 1 0 9 9h-9z" />
    <path d="M12 3v9h9" opacity="0.4" />
  </svg>
);

export const IconReports = (p: P) => (
  <svg {...base} className={p.className}>
    <path d="M4 19V5" />
    <path d="M4 19h16" />
    <path d="M8 16v-4" />
    <path d="M12 16V8" />
    <path d="M16 16v-6" />
  </svg>
);

export const IconTeam = (p: P) => (
  <svg {...base} className={p.className}>
    <circle cx="12" cy="8" r="3.2" />
    <path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
  </svg>
);

export const IconTag = (p: P) => (
  <svg {...base} className={p.className}>
    <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z" />
    <circle cx="7.5" cy="7.5" r="1.3" />
  </svg>
);

export const IconEmployees = (p: P) => (
  <svg {...base} className={p.className}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 4a3 3 0 0 1 0 6" />
    <path d="M18.5 20c0-2.4-.9-4-2.4-4.7" />
  </svg>
);

export const IconCalendar = (p: P) => (
  <svg {...base} className={p.className}>
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path d="M3 9h18M8 3v3M16 3v3" />
  </svg>
);

export const IconSettings = (p: P) => (
  <svg {...base} className={p.className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export const IconBell = (p: P) => (
  <svg {...base} className={p.className}>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
    <path d="M10.5 19a2 2 0 0 0 3 0" />
  </svg>
);

export const IconSun = (p: P) => (
  <svg {...base} className={p.className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
  </svg>
);

export const IconMoon = (p: P) => (
  <svg {...base} className={p.className}>
    <path d="M21 12.8A8 8 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z" />
  </svg>
);

export const IconChevronDown = (p: P) => (
  <svg {...base} className={p.className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconLogout = (p: P) => (
  <svg {...base} className={p.className}>
    <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
    <path d="M10 12h9l-3-3M19 12l-3 3" />
    <path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
  </svg>
);

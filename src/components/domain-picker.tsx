"use client";

import {
  DOMAIN_LABELS,
  DOMAIN_KEYS,
  DOMAIN_ICONS,
  DOMAIN_TO_SUB_DOMAINS,
  SUB_DOMAIN_LABELS,
  SUB_DOMAIN_HINTS,
  MEDICAL_MICRO_DOMAIN_LABELS,
  MEDICAL_SUB_DOMAIN_TO_MICRO_DOMAINS,
  domainForSubDomain,
  subDomainForMedicalMicroDomain,
  type DomainKey,
  type MedicalMicroDomainKey,
  type SubDomainKey,
} from "@/lib/labels";

const DOMAINS: DomainKey[] = [...DOMAIN_KEYS];

/**
 * Multi-select picker for annotator main domains (1-3) and optional sub-domains.
 *
 * Selection model:
 * - `domains` — array of `DomainKey` the annotator opts into.
 * - `subDomains` — array of `SubDomainKey`. Only sub-domains whose parent is in
 *   `domains` are persisted; when a parent domain is deselected, its sub-domains
 *   are dropped silently. Empty set for a given parent = "any sub-domain of that
 *   domain" (no narrowing) — this matches the API/DB semantics.
 *
 * Both arrays are controlled — caller owns state. `enforceMinOne` blocks the UI
 * from deselecting the last domain (server still validates).
 */
export interface DomainPickerProps {
  domains: DomainKey[];
  onDomainsChange: (next: DomainKey[]) => void;
  subDomains: SubDomainKey[];
  onSubDomainsChange: (next: SubDomainKey[]) => void;
  medicalMicroDomains?: MedicalMicroDomainKey[];
  onMedicalMicroDomainsChange?: (next: MedicalMicroDomainKey[]) => void;
  enforceMinOne?: boolean;
  disabled?: boolean;
  /**
   * Dynamic per-domain sub-domain whitelist (only IDs that have ≥1 article in DB).
   * Defaults to the full static taxonomy so legacy callers / tests work unchanged.
   * When a domain's list is empty, its chip + sub-domain panel are hidden entirely.
   */
  availableSubDomains?: Record<DomainKey, readonly SubDomainKey[]>;
}

export function DomainPicker({
  domains,
  onDomainsChange,
  subDomains,
  onSubDomainsChange,
  medicalMicroDomains = [],
  onMedicalMicroDomainsChange,
  enforceMinOne = true,
  disabled,
  availableSubDomains = DOMAIN_TO_SUB_DOMAINS,
}: DomainPickerProps) {
  const visibleDomains = DOMAINS.filter(
    (d) => (availableSubDomains[d]?.length ?? 0) > 0,
  );

  function toggleDomain(domain: DomainKey) {
    if (disabled) return;
    const has = domains.includes(domain);
    if (has) {
      if (enforceMinOne && domains.length === 1) return;
      onDomainsChange(domains.filter((d) => d !== domain));
      // Drop sub-domains whose parent was just deselected.
      const orphaned = subDomains.filter((s) => domainForSubDomain(s) !== domain);
      if (orphaned.length !== subDomains.length) onSubDomainsChange(orphaned);
      if (domain === "medical" && medicalMicroDomains.length > 0) {
        onMedicalMicroDomainsChange?.([]);
      }
    } else {
      onDomainsChange([...domains, domain]);
    }
  }

  function toggleSub(subId: SubDomainKey) {
    if (disabled) return;
    if (subDomains.includes(subId)) {
      onSubDomainsChange(subDomains.filter((s) => s !== subId));
      if (subId.startsWith("med_")) {
        onMedicalMicroDomainsChange?.(
          medicalMicroDomains.filter((microId) => subDomainForMedicalMicroDomain(microId) !== subId)
        );
      }
    } else {
      onSubDomainsChange([...subDomains, subId]);
    }
  }

  function toggleAllSubsForDomain(domain: DomainKey) {
    if (disabled) return;
    const all = availableSubDomains[domain] ?? [];
    const pickedInDomain = subDomains.filter((s) => domainForSubDomain(s) === domain);
    const restOfSelection = subDomains.filter((s) => domainForSubDomain(s) !== domain);
    if (pickedInDomain.length === all.length) {
      onSubDomainsChange(restOfSelection);
      if (domain === "medical") onMedicalMicroDomainsChange?.([]);
    } else {
      onSubDomainsChange([...restOfSelection, ...all]);
    }
  }

  function toggleMedicalMicro(microId: MedicalMicroDomainKey) {
    if (disabled) return;
    if (medicalMicroDomains.includes(microId)) {
      onMedicalMicroDomainsChange?.(medicalMicroDomains.filter((id) => id !== microId));
    } else {
      onMedicalMicroDomainsChange?.([...medicalMicroDomains, microId]);
    }
  }

  if (visibleDomains.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
        Chưa có dữ liệu trên hệ thống. Vui lòng liên hệ admin.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visibleDomains.map((domain) => {
        const active = domains.includes(domain);
        const allSubs = availableSubDomains[domain] ?? [];
        const pickedInDomain = subDomains.filter((s) => domainForSubDomain(s) === domain);
        const allChosen = pickedInDomain.length === allSubs.length;

        return (
          <div key={domain}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => toggleDomain(domain)}
              aria-pressed={active}
              className={
                "relative w-full px-4 py-4 rounded-xl border-2 text-left transition-all focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:opacity-50 " +
                (active
                  ? "border-blue-600 bg-blue-50"
                  : "border-dashed border-slate-300 bg-white hover:border-blue-300")
              }
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden>
                  {DOMAIN_ICONS[domain]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {DOMAIN_LABELS[domain]}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {domain === "law"
                      ? "Bài tư vấn pháp luật"
                      : domain === "tourism"
                      ? "Bài tư vấn du lịch"
                      : domain === "safety_compliance"
                      ? "Log an toàn, tuân thủ và rủi ro"
                      : "Bài tư vấn y khoa"}
                  </p>
                  {active && pickedInDomain.length > 0 ? (
                    <p className="text-[11px] text-blue-700 mt-1.5 font-medium">
                      Đã chọn {pickedInDomain.length}/{allSubs.length} chuyên ngành
                    </p>
                  ) : active ? (
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      Toàn lĩnh vực (chưa chọn chuyên ngành con)
                    </p>
                  ) : null}
                </div>
                {active ? (
                  <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-600 rounded-full shrink-0">
                    <svg
                      className="w-3 h-3 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </span>
                ) : null}
              </div>
            </button>

            {active ? (
              <div className="mt-2 ml-1 border border-slate-200 bg-slate-50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    Chuyên ngành — {DOMAIN_LABELS[domain]}
                  </p>
                  <button
                    type="button"
                    onClick={() => toggleAllSubsForDomain(domain)}
                    disabled={disabled}
                    className="text-[11px] text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
                  >
                    {allChosen ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {allSubs.map((subId) => {
                    const selected = subDomains.includes(subId);
                    return (
                      <button
                        key={subId}
                        type="button"
                        onClick={() => toggleSub(subId)}
                        disabled={disabled}
                        aria-pressed={selected}
                        title={SUB_DOMAIN_HINTS[subId]}
                        className={
                          "inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-50 " +
                          (selected
                            ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700"
                            : "bg-white border-slate-300 text-slate-600 hover:border-blue-300 hover:text-blue-700")
                        }
                      >
                        {SUB_DOMAIN_LABELS[subId]}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  Không chọn ⇒ nhận bài toàn lĩnh vực {DOMAIN_LABELS[domain]}.
                </p>
                {domain === "medical" && pickedInDomain.length > 0 ? (
                  <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                    <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                      Nhánh nhỏ hơn — Y tế
                    </p>
                    {pickedInDomain
                      .filter((subId): subId is keyof typeof MEDICAL_SUB_DOMAIN_TO_MICRO_DOMAINS =>
                        subId in MEDICAL_SUB_DOMAIN_TO_MICRO_DOMAINS
                      )
                      .map((subId) => {
                        const microIds = MEDICAL_SUB_DOMAIN_TO_MICRO_DOMAINS[subId];
                        return (
                          <div key={subId}>
                            <p className="mb-1 text-[11px] font-medium text-slate-500">
                              {SUB_DOMAIN_LABELS[subId]}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {microIds.map((microId) => {
                                const selected = medicalMicroDomains.includes(microId);
                                return (
                                  <button
                                    key={microId}
                                    type="button"
                                    onClick={() => toggleMedicalMicro(microId)}
                                    disabled={disabled}
                                    aria-pressed={selected}
                                    className={
                                      "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors disabled:opacity-50 " +
                                      (selected
                                        ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700"
                                        : "bg-white border-slate-300 text-slate-600 hover:border-emerald-300 hover:text-emerald-700")
                                    }
                                  >
                                    {MEDICAL_MICRO_DOMAIN_LABELS[microId]}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    <p className="text-[11px] text-slate-400">
                      Không chọn nhánh nhỏ ⇒ nhận mọi nhánh trong chuyên ngành y tế đã chọn.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

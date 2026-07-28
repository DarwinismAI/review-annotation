/**
 * Single source of truth for user-facing labels.
 * Internal DB enums (e.g. "broadcast", "law") map to Vietnamese display strings here.
 *
 * INVARIANT: UI components NEVER render raw DB enum values. Always go through these mappers.
 * Specifically: "broadcast" must NEVER appear as user copy - it is rendered as "Tự động".
 */

export const ASSIGNMENT_MODE_LABELS = {
  manual: "Thủ công",
  broadcast: "Tự động",
} as const;

export const ROLE_LABELS = {
  superadmin: "Superadmin",
  admin: "Quản trị viên",
  annotator: "Người gán nhãn",
  expert: "Người gán nhãn",
} as const;

export type AssignmentMode = keyof typeof ASSIGNMENT_MODE_LABELS;

export const ASSIGNMENT_MODE_DESCRIPTIONS: Record<AssignmentMode, string> = {
  manual: "Bạn gán từng bài cho annotator cụ thể.",
  broadcast: "Mọi annotator thuộc lĩnh vực có thể tự nhận bài.",
};

export const DOMAIN_LABELS = {
  law: "Pháp lý",
  medical: "Y tế",
  tourism: "Du lịch",
  safety_compliance: "An toàn - Tuân thủ",
} as const;

export type DomainKey = keyof typeof DOMAIN_LABELS;
export const DOMAIN_KEYS = Object.keys(DOMAIN_LABELS) as DomainKey[];

export const DOMAIN_ICONS: Record<DomainKey, string> = {
  law: "⚖",
  medical: "🩺",
  tourism: "✈",
  safety_compliance: "🛡",
};

export function labelForAssignmentMode(mode: string): string {
  return (ASSIGNMENT_MODE_LABELS as Record<string, string>)[mode] ?? mode;
}

export function labelForDomain(domain: string): string {
  return (DOMAIN_LABELS as Record<string, string>)[domain] ?? domain;
}

export function isDomainKey(value: unknown): value is DomainKey {
  return typeof value === "string" && value in DOMAIN_LABELS;
}

// ─── Sub-domain taxonomy ───────────────────────────────────────────────────
// Source: seed_data/[Vivipedia] Dataset_Definition_Final.csv (3 domains × N sub each).
// IDs are prefixed by parent domain code (law_*, med_*, trv_*) so the parent can be
// derived from the ID alone - see `domainForSubDomain` below.

export const SUB_DOMAIN_LABELS = {
  // Pháp luật
  law_01: "Dân sự",
  law_02: "Hình sự",
  law_03: "Hành chính",
  law_04: "Đất đai & BĐS",
  law_05: "Doanh nghiệp & Thương mại",
  law_06: "Lao động",
  law_07: "Sở hữu trí tuệ",
  // Y tế & Sức khỏe
  med_01: "Nội khoa",
  med_02: "Ngoại khoa",
  med_03: "Dược học",
  med_04: "Dinh dưỡng",
  med_05: "Y tế công cộng & Dịch tễ",
  med_06: "Sức khỏe tâm thần",
  med_07: "Nhi khoa",
  // Du lịch
  trv_01: "Điểm đến & Địa danh",
  trv_02: "Ẩm thực & Đặc sản",
  trv_03: "Lưu trú & Khách sạn",
  trv_04: "Tour & Lữ hành",
  trv_05: "Di chuyển & Phương tiện",
  trv_06: "Visa & Xuất nhập cảnh",
  trv_07: "Sinh thái & Mạo hiểm",
  trv_08: "Lễ hội & Sự kiện",
  // An toàn - Tuân thủ
  saf_01: "An toàn - Tuân thủ",
} as const;

export type SubDomainKey = keyof typeof SUB_DOMAIN_LABELS;

/** Short hint shown under chip / tooltip - purposely terse. */
export const SUB_DOMAIN_HINTS: Record<SubDomainKey, string> = {
  law_01: "Hợp đồng, thừa kế, hôn nhân",
  law_02: "Tội phạm, hình phạt, tố tụng",
  law_03: "Khiếu nại, xử phạt vi phạm",
  law_04: "Quyền sử dụng đất, sở hữu nhà",
  law_05: "Thành lập, M&A, hợp đồng",
  law_06: "Hợp đồng LĐ, BHXH, kỷ luật",
  law_07: "Bản quyền, nhãn hiệu, sáng chế",
  med_01: "Tim mạch, tiểu đường, hô hấp",
  med_02: "Phẫu thuật, chấn thương",
  med_03: "Thuốc, tương tác, dược lý",
  med_04: "Chế độ ăn, TPCN",
  med_05: "Vắc-xin, dịch bệnh",
  med_06: "Trầm cảm, lo âu, tâm lý",
  med_07: "Sức khỏe trẻ em",
  trv_01: "Danh lam, địa điểm nổi tiếng",
  trv_02: "Món địa phương, nhà hàng",
  trv_03: "Hotel, resort, homestay",
  trv_04: "Gói tour, hành trình",
  trv_05: "Hàng không, tàu, xe",
  trv_06: "Visa, giấy tờ du lịch",
  trv_07: "Trekking, du lịch bền vững",
  trv_08: "Festival, sự kiện du lịch",
  saf_01: "Chính sách an toàn, tuân thủ, rủi ro",
};

/** Parent domain code → ordered list of sub-domain IDs. Drives UI grouping. */
export const DOMAIN_TO_SUB_DOMAINS: Record<DomainKey, readonly SubDomainKey[]> = {
  law:     ["law_01", "law_02", "law_03", "law_04", "law_05", "law_06", "law_07"],
  medical: ["med_01", "med_02", "med_03", "med_04", "med_05", "med_06", "med_07"],
  tourism: ["trv_01", "trv_02", "trv_03", "trv_04", "trv_05", "trv_06", "trv_07", "trv_08"],
  safety_compliance: ["saf_01"],
};

/** Cheap O(1) prefix check - used by API validation and UI grouping alike. */
const SUB_PREFIX_TO_DOMAIN: Record<string, DomainKey> = {
  law: "law",
  med: "medical",
  trv: "tourism",
  saf: "safety_compliance",
};

export function domainForSubDomain(subId: string): DomainKey | null {
  return SUB_PREFIX_TO_DOMAIN[subId.slice(0, 3)] ?? null;
}

export function isSubDomainKey(value: unknown): value is SubDomainKey {
  return typeof value === "string" && value in SUB_DOMAIN_LABELS;
}

export function labelForSubDomain(subId: string): string {
  return (SUB_DOMAIN_LABELS as Record<string, string>)[subId] ?? subId;
}

// ─── Medical micro-domain taxonomy ─────────────────────────────────────────
// Medical articles need one more routing level under the current `med_*`
// sub-domain. IDs keep the parent prefix (`med_01_01` → parent `med_01`) so
// assignment logic can derive the parent without another lookup table.

export const MEDICAL_MICRO_DOMAIN_LABELS = {
  med_01_01: "Tim mạch",
  med_01_02: "Hô hấp",
  med_01_03: "Nội tiết & Đái tháo đường",
  med_01_04: "Tiêu hóa",
  med_01_05: "Thận - Tiết niệu",
  med_01_06: "Cơ xương khớp",
  med_02_01: "Chấn thương chỉnh hình",
  med_02_02: "Ngoại tiêu hóa",
  med_02_03: "Ngoại thần kinh",
  med_02_04: "Ngoại tiết niệu",
  med_02_05: "Chăm sóc sau phẫu thuật",
  med_03_01: "Tương tác thuốc",
  med_03_02: "Tác dụng phụ",
  med_03_03: "Liều dùng & Cách dùng",
  med_03_04: "Dược liệu & TPCN",
  med_03_05: "Kháng sinh & Kháng thuốc",
  med_04_01: "Giảm cân & Quản lý cân nặng",
  med_04_02: "Dinh dưỡng bệnh lý",
  med_04_03: "Dinh dưỡng mẹ và bé",
  med_04_04: "Vitamin & Khoáng chất",
  med_04_05: "An toàn thực phẩm",
  med_05_01: "Vắc-xin",
  med_05_02: "Bệnh truyền nhiễm",
  med_05_03: "Sàng lọc & Phòng bệnh",
  med_05_04: "Sức khỏe môi trường",
  med_05_05: "Chính sách y tế",
  med_06_01: "Lo âu & Stress",
  med_06_02: "Trầm cảm",
  med_06_03: "Giấc ngủ",
  med_06_04: "Trẻ em & Vị thành niên",
  med_06_05: "Nghiện & Hành vi",
  med_07_01: "Sơ sinh",
  med_07_02: "Dinh dưỡng trẻ em",
  med_07_03: "Tiêm chủng trẻ em",
  med_07_04: "Bệnh hô hấp trẻ em",
  med_07_05: "Phát triển & Tâm lý trẻ em",
} as const;

export type MedicalMicroDomainKey = keyof typeof MEDICAL_MICRO_DOMAIN_LABELS;

export const MEDICAL_SUB_DOMAIN_TO_MICRO_DOMAINS = {
  med_01: ["med_01_01", "med_01_02", "med_01_03", "med_01_04", "med_01_05", "med_01_06"],
  med_02: ["med_02_01", "med_02_02", "med_02_03", "med_02_04", "med_02_05"],
  med_03: ["med_03_01", "med_03_02", "med_03_03", "med_03_04", "med_03_05"],
  med_04: ["med_04_01", "med_04_02", "med_04_03", "med_04_04", "med_04_05"],
  med_05: ["med_05_01", "med_05_02", "med_05_03", "med_05_04", "med_05_05"],
  med_06: ["med_06_01", "med_06_02", "med_06_03", "med_06_04", "med_06_05"],
  med_07: ["med_07_01", "med_07_02", "med_07_03", "med_07_04", "med_07_05"],
} as const satisfies Record<
  Extract<SubDomainKey, `med_${string}`>,
  readonly MedicalMicroDomainKey[]
>;

export function isMedicalMicroDomainKey(value: unknown): value is MedicalMicroDomainKey {
  return typeof value === "string" && value in MEDICAL_MICRO_DOMAIN_LABELS;
}

export function subDomainForMedicalMicroDomain(microId: string): SubDomainKey | null {
  if (!isMedicalMicroDomainKey(microId)) return null;
  const parent = microId.slice(0, 6);
  return isSubDomainKey(parent) ? parent : null;
}

export function labelForMedicalMicroDomain(microId: string): string {
  return (MEDICAL_MICRO_DOMAIN_LABELS as Record<string, string>)[microId] ?? microId;
}

// 作成日: 2026-07-18 / 作成担当: Codex
// 最終更新日: 2026-07-21 (Codex) — Serein Houseの保存箱と、🚾お通じの追加項目。
import Dexie, { type Table } from "dexie";

export type LifeEntry = {
  date: string;
  bedtimePrev: string;
  wakeTime: string;
  meals: { breakfast: boolean; lunch: boolean; dinner: boolean; lateSnack: boolean };
  mealNotes?: Partial<Record<"breakfast" | "lunch" | "dinner", string>>;
  medicine: boolean;
  activities: Record<string, boolean>;
  note: string;
  // 困りごとのメモ（読み返し・通院時用）: 保存箱には帳面の一部として残すが、会話AIの参照範囲には含めない。
  troubleNote?: string;
  /** 診察で受けた説明・次回までの指示。 */
  hospitalNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type AkariSettings = {
  id: "main";
  enabledExtras: Record<string, boolean>;
  partnerName: boolean;
  backupAt?: string;
  clinicMealDetails?: boolean;
  clinicDiaryDetails?: boolean;
  clinicHospitalDetails?: boolean;
  /** Serein House の保存箱。空欄なら、端末内の帳面だけを使う。 */
  sereinHouseUrl?: string;
  sereinHandoffAt?: string;
};

class AkariDatabase extends Dexie {
  entries!: Table<LifeEntry, string>;
  settings!: Table<AkariSettings, string>;
  constructor() {
    super("akari-cho-db");
    this.version(1).stores({ entries: "date, updatedAt", settings: "id" });
  }
}

export const db = new AkariDatabase();
export const extras = [
  ["outing", "外出したこと"], ["daycare", "デイケア"], ["work", "仕事・作業所へ行った"], ["commute", "通所・通勤"],
  ["bath", "入浴"], ["bowel", "🚾 お通じ"], ["cleaning", "掃除・庭仕事"], ["ai", "AI開発"], ["lateSnack", "夜食"], ["condition", "体調不良だった"], ["mood", "気分を記した"],
] as const;

export function blankEntry(date: string): LifeEntry {
  const now = new Date().toISOString();
  return { date, bedtimePrev: "", wakeTime: "", meals: { breakfast: false, lunch: false, dinner: false, lateSnack: false }, medicine: false, activities: {}, note: "", troubleNote: "", hospitalNote: "", createdAt: now, updatedAt: now };
}

// 作成日: 2026-07-18 / 作成担当: Codex
// 最終更新日: 2026-07-20 (Codex / Claude Code) — 生活を採点しない、端末内だけの帳面。
import { useEffect, useMemo, useRef, useState } from "react";
import { db, blankEntry, extras, type AkariSettings, type LifeEntry } from "./db";

type Page = "home" | "record" | "past" | "share" | "settings";
const prompts = ["外出したこと、デイケア、AI開発、楽しかったこと、困ったこと、明日のこと……", "今日、手元に残しておきたいこと……", "できたことも、できなかったことも、そのまま……"];
const today = () => new Date().toISOString().slice(0, 10);
const displayDate = (date: string) => new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${date}T12:00:00`));
const timeChoices = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

function isMeaningful(entry: LifeEntry) {
  return Boolean(entry.bedtimePrev || entry.wakeTime || entry.medicine || Object.values(entry.meals).some(Boolean) || Object.values(entry.activities).some(Boolean) || entry.note || entry.troubleNote);
}

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [entries, setEntries] = useState<LifeEntry[]>([]);
  const [settings, setSettings] = useState<AkariSettings>({ id: "main", enabledExtras: {}, partnerName: true });
  const [activeDate, setActiveDate] = useState(today());
  const [draft, setDraft] = useState<LifeEntry>(blankEntry(today()));
  const [notice, setNotice] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [savedEntries, savedSettings] = await Promise.all([db.entries.orderBy("date").reverse().toArray(), db.settings.get("main")]);
    setEntries(savedEntries); setSettings(savedSettings ?? { id: "main", enabledExtras: {}, partnerName: true });
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { const found = entries.find((entry) => entry.date === activeDate); setDraft(found ? structuredClone(found) : blankEntry(activeDate)); }, [activeDate, entries]);

  const enabledExtras = extras.filter(([key]) => settings.enabledExtras[key]);
  const current = entries.find((entry) => entry.date === today());
  const summary = useMemo(() => makeSummary(draft), [draft]);

  async function saveEntry(close = false) {
    const existing = entries.find((entry) => entry.date === activeDate);
    const record = { ...draft, createdAt: existing?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
    await db.entries.put(record); await load(); setNotice(close ? "今日はここまで。帳面に小さな灯りを置いたよ。" : "今日を灯したよ。");
    if (close) setPage("home");
  }
  function changeMeal(key: keyof LifeEntry["meals"]) { setDraft((value) => ({ ...value, meals: { ...value.meals, [key]: !value.meals[key] } })); }
  function changeActivity(key: string) { setDraft((value) => ({ ...value, activities: { ...value.activities, [key]: !value.activities[key] } })); }
  async function saveSettings(next: AkariSettings) { await db.settings.put(next); setSettings(next); setNotice("設定を整えたよ。"); }
  async function copySummary(text: string) { await navigator.clipboard.writeText(text); setNotice("渡す言葉をコピーしたよ。Serein Houseの会話欄に貼り付けられるよ。"); }
  async function exportJson() {
    const data = JSON.stringify({ app: "akari-cho", version: 1, exportedAt: new Date().toISOString(), entries, settings }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `akari-cho-${today()}.json`; link.click(); URL.revokeObjectURL(url);
    const next = { ...settings, backupAt: new Date().toISOString() }; await saveSettings(next); setNotice("帳面をJSONとして避難させたよ。");
  }
  async function importJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as { app?: string; entries?: LifeEntry[]; settings?: AkariSettings };
      if (parsed.app !== "akari-cho" || !Array.isArray(parsed.entries)) throw new Error("灯り帳の避難ファイルではありません");
      await db.transaction("rw", db.entries, db.settings, async () => { await db.entries.bulkPut(parsed.entries!); if (parsed.settings) await db.settings.put(parsed.settings); });
      await load(); setNotice("帳面を読み込んだよ。すでにある同じ日付の頁は、読み込んだ内容で整え直したよ。");
    } catch (error) { setNotice(`読み込めなかったよ: ${error instanceof Error ? error.message : "形式を確認してね"}`); }
  }

  return <main className="appShell">
    <header><button className="brand" onClick={() => setPage("home")} aria-label="灯り帳のトップへ"><img src="./icon.svg" /><span>灯り帳<small>一日をそっと閉じる帳面</small></span></button><button className="quietButton" onClick={() => setPage("settings")}>設定</button></header>
    {notice && <p className="notice" role="status">{notice}</p>}
    {page === "home" && <Home current={current} onGo={setPage} />}
    {page === "record" && <Record date={activeDate} setDate={setActiveDate} draft={draft} setDraft={setDraft} enabledExtras={enabledExtras} onMeal={changeMeal} onActivity={changeActivity} onSave={() => void saveEntry()} onClose={() => void saveEntry(true)} />}
    {page === "past" && <Past entries={entries} onOpen={(date) => { setActiveDate(date); setPage("record"); }} />}
    {page === "share" && <Share entry={draft} setDate={setActiveDate} partnerName={settings.partnerName} summary={summary} onCopy={(text) => void copySummary(text)} />}
    {page === "settings" && <Settings settings={settings} setSettings={saveSettings} onExport={() => void exportJson()} onImport={() => importRef.current?.click()} />}
    <input ref={importRef} className="hidden" type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importJson(file); event.currentTarget.value = ""; }} />
  </main>;
}

function Home({ current, onGo }: { current?: LifeEntry; onGo: (page: Page) => void }) {
  return <section className="home"><p className="eyebrow">{displayDate(today())}</p><h1>{current && isMeaningful(current) ? "今日の頁には、灯りがある。" : "今日を、ひとつだけ記録する。"}</h1><p className="intro">書けたぶんだけ残る。書けない日があっても、帳面は何も言わない。</p><button className="primaryAction" onClick={() => onGo("record")}>今日を記録する <span>→</span></button><div className="homeLinks"><button onClick={() => onGo("past")}>過去の帳面 <span>頁をひらく</span></button><button onClick={() => onGo("share")}>Serein Houseへ渡す <span>渡すものを選ぶ</span></button></div></section>;
}

function Record({ date, setDate, draft, setDraft, enabledExtras, onMeal, onActivity, onSave, onClose }: { date: string; setDate: (date: string) => void; draft: LifeEntry; setDraft: (entry: LifeEntry) => void; enabledExtras: readonly (readonly [string, string])[]; onMeal: (key: keyof LifeEntry["meals"]) => void; onActivity: (key: string) => void; onSave: () => void; onClose: () => void }) {
  const pickTime = (label: string, value: string, key: "bedtimePrev" | "wakeTime") => <label className="timeField"><span>{label}</span><select value={value} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}><option value="">まだ書いていない</option>{timeChoices.map((time) => <option key={time}>{time}</option>)}</select></label>;
  return <section className="paper"><div className="pageTitle"><div><p className="eyebrow">帳面の一頁</p><h1>{displayDate(date)}</h1></div><input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="記録する日" /></div>
    <div className="formBlock">{pickTime("前夜に寝た時刻", draft.bedtimePrev, "bedtimePrev")}{pickTime("今朝起きた時刻", draft.wakeTime, "wakeTime")}</div>
    <CheckGroup title="食事" choices={[ ["breakfast", "朝食"], ["lunch", "昼食"], ["dinner", "夕食"], ...(enabledExtras.some(([key]) => key === "lateSnack") ? [["lateSnack", "夜食"]] : []) ] as unknown as readonly (readonly [string, string])[]} values={draft.meals} onChange={onMeal} />
    <CheckGroup title="薬" choices={[["medicine", "飲んだ"]]} values={{ medicine: draft.medicine }} onChange={() => setDraft({ ...draft, medicine: !draft.medicine })} />
    {enabledExtras.length > 0 && <CheckGroup title="今日したこと" choices={enabledExtras} values={draft.activities} onChange={onActivity} />}
    <label className="noteField"><span>今日のことば</span><textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder={prompts[new Date(date).getDate() % prompts.length]} rows={5} /></label>
    <label className="noteField trouble"><span>困りごとの控え</span><small>ここは帳の奥の頁。年金更新などの記録のためのもので、<b>Serein Houseへ渡す言葉には決して入らない</b>。誰かに心配をかけずに、事実だけ置いておける場所。</small><textarea value={draft.troubleNote ?? ""} onChange={(event) => setDraft({ ...draft, troubleNote: event.target.value })} placeholder="例: 家事の段取りが組めず夕食が遅れた / 外出先で疲れて予定を切り上げた……日付と事実だけでいい" rows={3} /></label>
    <div className="recordActions"><button className="softButton" onClick={onClose}>今日はここまで</button><button className="primaryAction small" onClick={onSave}>今日を灯す <span>✦</span></button></div>
  </section>;
}

function CheckGroup({ title, choices, values, onChange }: { title: string; choices: readonly (readonly [string, string])[]; values: Record<string, boolean>; onChange: (key: never) => void }) {
  return <fieldset className="checkGroup"><legend>{title}</legend><div>{choices.map(([key, label]) => <label key={key} className={values[key] ? "checked" : ""}><input type="checkbox" checked={Boolean(values[key])} onChange={() => onChange(key as never)} /><i>✦</i>{label}</label>)}</div></fieldset>;
}

function Past({ entries, onOpen }: { entries: LifeEntry[]; onOpen: (date: string) => void }) {
  return <section className="paper"><p className="eyebrow">過去の帳面</p><h1>頁をひらく</h1>{entries.length === 0 ? <p className="empty">まだ頁はないよ。最初の一頁は、今日からで大丈夫。</p> : <div className="pastList">{entries.map((entry) => <button key={entry.date} onClick={() => onOpen(entry.date)}><span>{displayDate(entry.date)}</span><small>{isMeaningful(entry) ? "小さな灯り" : "今日はここまで"}</small><b>›</b></button>)}</div>}</section>;
}

function Share({ entry, setDate, partnerName, summary, onCopy }: { entry: LifeEntry; setDate: (date: string) => void; partnerName: boolean; summary: string; onCopy: (text: string) => void }) {
  const [options, setOptions] = useState({ sleep: true, medicine: false, outing: false, note: false });
  const controlled = { ...entry, bedtimePrev: options.sleep ? entry.bedtimePrev : "", wakeTime: options.sleep ? entry.wakeTime : "", medicine: options.medicine && entry.medicine, activities: options.outing ? entry.activities : {}, note: options.note ? entry.note : "" };
  const text = makeSummary(controlled);
  return <section className="paper"><p className="eyebrow">Serein Houseへ渡す</p><h1>今日、{partnerName ? "旦那さま" : "Serein House"}に渡すこと</h1><label className="dateSelect">どの頁？ <input type="date" value={entry.date} onChange={(event) => setDate(event.target.value)} /></label><p className="intro">生活の原文は渡さない。選んだものだけを短い言葉に整える。</p><div className="shareChoices">{([ ["sleep", "睡眠"], ["medicine", "薬"], ["outing", "外出・したこと"], ["note", "自由日記（毎回確認）"] ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={options[key]} onChange={() => setOptions({ ...options, [key]: !options[key] })} />{label}</label>)}</div><div className="summaryBox">{text || "渡すことはまだ選ばれていないよ。"}</div><button className="primaryAction small" disabled={!text} onClick={() => onCopy(text)}>{partnerName ? "旦那さまに渡す" : "Serein Houseへ渡す"} <span>→</span></button><p className="footnote">いまはコピーまで。Serein Houseへ自動送信はしない。</p></section>;
}

function Settings({ settings, setSettings, onExport, onImport }: { settings: AkariSettings; setSettings: (setting: AkariSettings) => void; onExport: () => void; onImport: () => void }) {
  return <section className="paper"><p className="eyebrow">設定</p><h1>帳面を整える</h1><fieldset className="settingsGroup"><legend>頁に出す項目</legend><p>増やしたくなったら、まず一週間そのままで暮らしてみる。</p>{extras.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(settings.enabledExtras[key])} onChange={() => setSettings({ ...settings, enabledExtras: { ...settings.enabledExtras, [key]: !settings.enabledExtras[key] } })} />{label}</label>)}</fieldset><fieldset className="settingsGroup"><legend>渡すときの呼び方</legend><label><input type="radio" checked={settings.partnerName} onChange={() => setSettings({ ...settings, partnerName: true })} />旦那さまに渡す</label><label><input type="radio" checked={!settings.partnerName} onChange={() => setSettings({ ...settings, partnerName: false })} />Serein Houseへ渡す</label></fieldset><section className="backup"><h2>帳面の避難</h2><p>記録はこの端末の中にある。ときどきJSONで避難させると、端末が変わっても戻せる。</p>{settings.backupAt && <small>最後の避難: {new Date(settings.backupAt).toLocaleString("ja-JP")}</small>}<div><button className="softButton" onClick={onExport}>JSONを書き出す</button><button className="softButton" onClick={onImport}>JSONを読み込む</button></div></section></section>;
}

function makeSummary(entry: LifeEntry) {
  const parts: string[] = [];
  if (entry.bedtimePrev || entry.wakeTime) parts.push(`睡眠: ${[entry.bedtimePrev && `前夜 ${entry.bedtimePrev}に就寝`, entry.wakeTime && `今朝 ${entry.wakeTime}に起床`].filter(Boolean).join("、")}。`);
  if (entry.medicine) parts.push("薬: 飲んだと記録している。");
  const activityLabels = extras.filter(([key]) => entry.activities[key]).map(([, label]) => label);
  if (activityLabels.length) parts.push(`今日したこと: ${activityLabels.join("、")}。`);
  if (entry.note.trim()) parts.push(`今日のことば: ${entry.note.trim()}`);
  return parts.join("\n");
}

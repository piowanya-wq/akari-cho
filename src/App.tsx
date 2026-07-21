// 作成日: 2026-07-18 / 作成担当: Codex
// 最終更新日: 2026-07-21 (Codex) — 生活の全頁をSerein Houseの保存箱へ渡せるようにする。AIの参照範囲はHouse側で別管理。
import { useEffect, useMemo, useRef, useState } from "react";
import { db, blankEntry, extras, type AkariSettings, type LifeEntry } from "./db";

type Page = "home" | "record" | "past" | "settings" | "clinic";
type Theme = "night" | "paper" | "forest" | "rose";
const coreItems = [["sleep", "💤 寝た・🌞 起きた時刻"], ["meals", "🍚 食事"], ["note", "📕 今日のことば"], ["hospital", "🏥 病院で言われたこと"], ["trouble", "✋ 困りごとのメモ（読み返し・通院時用）"]] as const;
const defaultVisible = Object.fromEntries(coreItems.map(([key]) => [key, true])) as Record<string, boolean>;
const prompts = ["外出したこと、デイケア、AI開発、楽しかったこと、困ったこと、明日のこと……", "今日、手元に残しておきたいこと……", "できたことも、できなかったことも、そのまま……"];
const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const displayDate = (date: string) => new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${date}T12:00:00`));
const timeChoices = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

function isMeaningful(entry: LifeEntry) {
  return Boolean(entry.bedtimePrev || entry.wakeTime || entry.medicine || Object.values(entry.meals).some(Boolean) || Object.values(entry.activities).some(Boolean) || entry.note || entry.troubleNote || entry.hospitalNote);
}

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [entries, setEntries] = useState<LifeEntry[]>([]);
  const [settings, setSettings] = useState<AkariSettings>({ id: "main", enabledExtras: {}, partnerName: true, visibleSections: defaultVisible, customItems: [], theme: "night" });
  const [activeDate, setActiveDate] = useState(today());
  const [draft, setDraft] = useState<LifeEntry>(blankEntry(today()));
  const [notice, setNotice] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [savedEntries, savedSettings] = await Promise.all([db.entries.orderBy("date").reverse().toArray(), db.settings.get("main")]);
    setEntries(savedEntries); setSettings(savedSettings ? { ...savedSettings, visibleSections: { ...defaultVisible, ...(savedSettings.visibleSections ?? {}) }, customItems: savedSettings.customItems ?? [], theme: savedSettings.theme ?? "night" } : { id: "main", enabledExtras: {}, partnerName: true, visibleSections: defaultVisible, customItems: [], theme: "night" });
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { const found = entries.find((entry) => entry.date === activeDate); setDraft(found ? structuredClone(found) : blankEntry(activeDate)); }, [activeDate, entries]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const yesterdayDate = new Date(yesterday.getTime() - yesterday.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
      const nextDate = today();
      if (page !== "record" || activeDate !== yesterdayDate || activeDate === nextDate) return;

      const existing = entries.find((entry) => entry.date === activeDate);
      if (isMeaningful(draft) || existing) {
        const record = { ...draft, createdAt: existing?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
        void db.entries.put(record).then(() => load());
      }
      setActiveDate(nextDate);
      setNotice("日付が変わったから、前の頁を残して今日の頁をひらいたよ。");
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeDate, draft, entries, page]);

  const enabledExtras = extras.filter(([key]) => settings.enabledExtras[key]);
  const visible = { ...defaultVisible, ...(settings.visibleSections ?? {}) };
  const current = entries.find((entry) => entry.date === today());

  async function saveEntry(close = false) {
    const existing = entries.find((entry) => entry.date === activeDate);
    const record = { ...draft, createdAt: existing?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
    await db.entries.put(record); await load(); setNotice(close ? "今日はここまで。帳面に小さな灯りを置いたよ。" : "今日を灯したよ。");
    if (close) setPage("home");
  }
  function changeMeal(key: keyof LifeEntry["meals"]) { setDraft((value) => ({ ...value, meals: { ...value.meals, [key]: !value.meals[key] } })); }
  function changeActivity(key: string) { setDraft((value) => ({ ...value, activities: { ...value.activities, [key]: !value.activities[key] } })); }
  async function saveSettings(next: AkariSettings) { await db.settings.put(next); setSettings(next); setNotice("設定を整えたよ。項目を外しても、過去の記録は消えないよ。"); }
  async function renameCustomItem(oldName: string, newName: string) {
    const nextName = newName.trim();
    if (!nextName || nextName === oldName) { setNotice("名前は変わっていないよ。"); return; }
    const nextEntries = entries.map((entry) => {
      if (!entry.activities[oldName]) return entry;
      const activities = { ...entry.activities, [nextName]: Boolean(entry.activities[nextName] || entry.activities[oldName]) };
      delete activities[oldName];
      return { ...entry, activities, updatedAt: new Date().toISOString() };
    });
    const customItems = (settings.customItems ?? []).filter((item) => item !== oldName);
    if (!customItems.includes(nextName)) customItems.push(nextName);
    await db.transaction("rw", db.entries, db.settings, async () => { await db.entries.bulkPut(nextEntries); await db.settings.put({ ...settings, customItems }); });
    await load(); setNotice("項目名を直したよ。過去の記録の項目名も変わったよ。");
  }
  async function deleteBefore(date: string) {
    const count = entries.filter((entry) => entry.date < date).length;
    if (!count) { setNotice("選んだ期間に整理する記録はないよ。"); return; }
    await db.entries.where("date").below(date).delete(); await load(); setNotice("選んだ日より前の記録を整理したよ。");
  }
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

  async function handoffToSereinHouse() {
    const baseUrl = settings.sereinHouseUrl?.trim().replace(/\/$/, "");
    if (!baseUrl) { setNotice("先にSerein HouseのURLを設定してね。"); return; }
    try {
      const response = await fetch(baseUrl + "/api/life-records/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: "akari-cho", version: 1, exportedAt: new Date().toISOString(), entries }),
      });
      if (!response.ok) throw new Error("保存箱が応答しませんでした（" + response.status + "）");
      const next = { ...settings, sereinHandoffAt: new Date().toISOString() };
      await saveSettings(next);
      setNotice("灯り帳の" + entries.length + "頁を、Serein Houseの保存箱へ写したよ。会話のAIにはまだ渡らない。");
    } catch (error) {
      setNotice("保存箱へ渡せなかったよ: " + (error instanceof Error ? error.message : "接続を確認してね"));
    }
  }

  return <main className={`appShell theme-${settings.theme ?? "night"}`}>
    <header><button className="brand" onClick={() => setPage("home")} aria-label="灯り帳のトップへ"><img src="./icon.svg" /><span>灯り帳<small>一日をそっと閉じる帳面</small></span></button><button className="quietButton" onClick={() => setPage("settings")}>設定</button></header>
    {notice && <p className="notice" role="status">{notice}</p>}
    {page === "home" && <Home current={current} onGo={setPage} />}
    {page === "record" && <Record date={activeDate} setDate={setActiveDate} draft={draft} setDraft={setDraft} visible={visible} enabledExtras={enabledExtras} customItems={settings.customItems ?? []} onMeal={changeMeal} onActivity={changeActivity} onSave={() => void saveEntry()} onClose={() => void saveEntry(true)} />}
    {page === "past" && <Past entries={entries} onOpen={(date) => { setActiveDate(date); setPage("record"); }} />}
    {page === "clinic" && <Clinic entries={entries} settings={settings} />}
    {page === "settings" && <Settings settings={settings} entries={entries} setSettings={saveSettings} onExport={() => void exportJson()} onImport={() => importRef.current?.click()} onHandoff={() => void handoffToSereinHouse()} onDeleteBefore={(date) => void deleteBefore(date)} onRename={(oldName, newName) => void renameCustomItem(oldName, newName)} />}
    <input ref={importRef} className="hidden" type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importJson(file); event.currentTarget.value = ""; }} />
  </main>;
}

function Home({ current, onGo }: { current?: LifeEntry; onGo: (page: Page) => void }) {
  return <section className="home"><p className="eyebrow">{displayDate(today())}</p><h1>{current && isMeaningful(current) ? "今日の頁には、灯りがある。" : "今日を記録する。"}</h1><p className="intro">書けたぶんだけ残る。書けない日があっても、帳面は何も言わない。</p><button className="primaryAction" onClick={() => onGo("record")}>今日を記録する <span>→</span></button><div className="homeLinks"><button onClick={() => onGo("past")}>読み返す <span>過去の頁をひらく</span></button><button onClick={() => onGo("clinic")}>通院時に見せるメモ <span>過去30日をまとめる</span></button></div></section>;
}

function Record({ date, setDate, draft, setDraft, visible, enabledExtras, customItems, onMeal, onActivity, onSave, onClose }: { date: string; setDate: (date: string) => void; draft: LifeEntry; setDraft: (entry: LifeEntry) => void; visible: Record<string, boolean>; enabledExtras: readonly (readonly [string, string])[]; customItems: string[]; onMeal: (key: keyof LifeEntry["meals"]) => void; onActivity: (key: string) => void; onSave: () => void; onClose: () => void }) {
  const pickTime = (label: string, value: string, key: "bedtimePrev" | "wakeTime") => <label className="timeField"><span>{label}</span><select value={value} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}><option value="">まだ書いていない</option>{timeChoices.map((time) => <option key={time}>{time}</option>)}</select></label>;
  const mealChoices: readonly (readonly [string, string])[] = [["breakfast", "朝食"], ["lunch", "昼食"], ["dinner", "夕食"], ...(enabledExtras.some(([key]) => key === "lateSnack") ? [["lateSnack", "夜食"] as [string, string]] : [])];
  return <section className="paper"><div className="pageTitle"><div><p className="eyebrow">帳面の一頁</p><h1>{displayDate(date)}</h1></div><input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="記録する日" /></div>
    {visible.sleep && <div className="formBlock">{pickTime("前夜に寝た時刻", draft.bedtimePrev, "bedtimePrev")}{pickTime("今朝起きた時刻", draft.wakeTime, "wakeTime")}</div>}
    {visible.meals && <><CheckGroup title="食事" choices={mealChoices} values={draft.meals} onChange={onMeal} /><div className="mealNotes">{([ ["breakfast", "朝食に食べたもの"], ["lunch", "昼食に食べたもの"], ["dinner", "夕食に食べたもの"] ] as const).map(([key, label]) => <label key={key}><span>{label}</span><input value={draft.mealNotes?.[key] ?? ""} onChange={(event) => setDraft({ ...draft, meals: { ...draft.meals, [key]: true }, mealNotes: { ...draft.mealNotes, [key]: event.target.value } })} placeholder="例: おにぎり、味噌汁" /></label>)}</div></>}
    <CheckGroup title="薬" choices={[["medicine", "飲んだ"]]} values={{ medicine: draft.medicine }} onChange={() => setDraft({ ...draft, medicine: !draft.medicine })} />
    {enabledExtras.length > 0 && <CheckGroup title="今日したこと" choices={enabledExtras} values={draft.activities} onChange={onActivity} />}
    {customItems.length > 0 && <CheckGroup title="自分で作った項目" choices={customItems.map((item) => [item, item] as const)} values={draft.activities} onChange={onActivity} />}
    {visible.note && <label className="noteField"><span>今日のことば</span><textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder={prompts[new Date(date).getDate() % prompts.length]} rows={5} /></label>}
    {visible.hospital && <label className="noteField"><span>🏥 病院で言われたこと</span><small>診察で聞いたこと、次回までにすること、薬や生活についての説明を、あとで読み返せるように残す。</small><textarea value={draft.hospitalNote ?? ""} onChange={(event) => setDraft({ ...draft, hospitalNote: event.target.value })} placeholder="例: 次回は○月ごろ / 薬はこのまま様子を見る / 無理のない範囲で散歩" rows={3} /></label>}
    {visible.trouble && <label className="noteField trouble"><span>困りごとのメモ（読み返し・通院時用）</span><small>ここは帳の奥の頁。あとで読み返したり、通院時に見せたりするためのメモ。保存箱へは帳面の一部として写るが、<b>会話のAIにはまだ渡らない</b>。誰かに心配をかけずに、事実だけ置いておける場所。</small><textarea value={draft.troubleNote ?? ""} onChange={(event) => setDraft({ ...draft, troubleNote: event.target.value })} placeholder="例: 家事の段取りが組めず夕食が遅れた / 外出先で疲れて予定を切り上げた……日付と事実だけでいい" rows={3} /></label>}
    <div className="recordActions"><button className="softButton" onClick={onClose}>今日はここまで</button><button className="primaryAction small" onClick={onSave}>今日を灯す <span>✦</span></button></div>
  </section>;
}

function CheckGroup({ title, choices, values, onChange }: { title: string; choices: readonly (readonly [string, string])[]; values: Record<string, boolean>; onChange: (key: never) => void }) {
  return <fieldset className="checkGroup"><legend>{title}</legend><div>{choices.map(([key, label]) => <label key={key} className={values[key] ? "checked" : ""}><input type="checkbox" checked={Boolean(values[key])} onChange={() => onChange(key as never)} /><i>✦</i>{label}</label>)}</div></fieldset>;
}

function Past({ entries, onOpen }: { entries: LifeEntry[]; onOpen: (date: string) => void }) {
  return <section className="paper"><p className="eyebrow">過去の帳面</p><h1>頁をひらく</h1>{entries.length === 0 ? <p className="empty">まだ頁はないよ。最初の一頁は、今日からで大丈夫。</p> : <div className="pastList">{entries.map((entry) => <button key={entry.date} onClick={() => onOpen(entry.date)}><span>{displayDate(entry.date)}</span><small>{isMeaningful(entry) ? "小さな灯り" : "今日はここまで"}</small><b>›</b></button>)}</div>}</section>;
}

function Settings({ settings, entries, setSettings, onExport, onImport, onHandoff, onDeleteBefore, onRename }: { settings: AkariSettings; entries: LifeEntry[]; setSettings: (setting: AkariSettings) => void; onExport: () => void; onImport: () => void; onHandoff: () => void; onDeleteBefore: (date: string) => void; onRename: (oldName: string, newName: string) => void }) {
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [editingFrom, setEditingFrom] = useState<string>();
  const [cleanupDate, setCleanupDate] = useState(today());
  const [cleanupStep, setCleanupStep] = useState<"idle" | "backup" | "confirm">("idle");
  const visible = { ...defaultVisible, ...(settings.visibleSections ?? {}) };
  const custom = settings.customItems ?? [];
  const add = () => { const value = name.trim(); if (!value || custom.includes(value)) return; setSettings({ ...settings, customItems: [...custom, value] }); setName(""); };
  const remove = () => { if (!removing) return; setSettings({ ...settings, customItems: custom.filter((value) => value !== removing) }); setRemoving(undefined); };
  const edit = () => { const value = (editing ?? "").trim(); if (!value || !editingFrom) return; onRename(editingFrom, value); setEditing(undefined); setEditingFrom(undefined); };
  const cleanupCount = entries.filter((entry) => entry.date < cleanupDate).length;
  return <section className="paper"><p className="eyebrow">設定</p><h1>項目を整える</h1>
    <fieldset className="settingsGroup"><legend>記録する項目</legend><p>外しても、過去に書いた記録は消えない。</p>{coreItems.map(([key, label]) => <label key={key}><input type="checkbox" checked={visible[key]} onChange={() => setSettings({ ...settings, visibleSections: { ...visible, [key]: !visible[key] } })} />{label}</label>)}{extras.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(settings.enabledExtras[key])} onChange={() => setSettings({ ...settings, enabledExtras: { ...settings.enabledExtras, [key]: !settings.enabledExtras[key] } })} />{label}</label>)}</fieldset>
    <fieldset className="settingsGroup"><legend>自分で作る項目</legend><p>例: 朝の薬（ミヤBM）、散歩、家事、リハビリ。<br /><b>編集</b>は打ち間違いを直すためのもの。端末内の過去記録の項目名も、新しい名前へ変わる。薬の種類が変わったら、編集せず新しい項目を作ってそちらに切り替えてね。作った項目は記録画面に出る。</p><div className="itemAdd"><input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="名前を書く" /><button className="softButton" onClick={add}>追加</button></div><div className="itemList">{custom.map((value) => <span key={value}>{value}<button onClick={() => { setEditing(value); setEditingFrom(value); }}>編集</button><button onClick={() => setRemoving(value)}>削除</button></span>)}</div>{editing && <div className="deleteConfirm"><p>「{editingFrom}」の名前を直す</p><small>打ち間違いを直す用途。過去の記録の項目名も新しい名前へ変わる。薬の種類が変わった時は、編集せず新しい項目を追加する。</small><div><input value={editing} onChange={(event) => setEditing(event.target.value)} /><button className="softButton" onClick={() => setEditing(undefined)}>やめる</button><button className="rustButton" onClick={edit}>この名前へ直す</button></div></div>}{removing && <div className="deleteConfirm"><p>「{removing}」を項目一覧から削除する？</p><small>いま使う項目一覧から外れるだけ。過去データとJSONには残るが、通常の記録画面・通院時に見せるメモからは表示されなくなる。JSONを読み込んでも同じ扱い。</small><div><button className="softButton" onClick={() => setRemoving(undefined)}>やめる</button><button className="rustButton" onClick={remove}>削除する</button></div></div>}</fieldset>
    <fieldset className="settingsGroup"><legend>通院時に見せるメモに表示するもの</legend><p>記録を読み返したい時は、その項目をチェック。通院時は、医師に伝えたい項目だけをチェック。</p><label><input type="checkbox" checked={Boolean(settings.clinicMealDetails)} onChange={() => setSettings({ ...settings, clinicMealDetails: !settings.clinicMealDetails })} />🍚 食事の内容（困りごとのメモの下に出す）</label><label><input type="checkbox" checked={Boolean(settings.clinicDiaryDetails)} onChange={() => setSettings({ ...settings, clinicDiaryDetails: !settings.clinicDiaryDetails })} />📕 今日のことば（通院メモの下にまとめて出す）</label><label><input type="checkbox" checked={Boolean(settings.clinicHospitalDetails)} onChange={() => setSettings({ ...settings, clinicHospitalDetails: !settings.clinicHospitalDetails })} />🏥 病院で言われたこと（通院メモの下にまとめて出す）</label></fieldset>
    <section className="backup"><h2>Serein Houseの保存箱</h2><p>灯り帳の全頁を、パソコンの生活記録棚へ写す。ここで写しただけでは、会話のAIは読まない。AIが何を参照できるかはSerein House側で決める。</p><label className="noteField"><span>Serein HouseのURL</span><input value={settings.sereinHouseUrl ?? ""} onChange={(event) => setSettings({ ...settings, sereinHouseUrl: event.target.value })} placeholder="例: https://meg1.tailaf24fe.ts.net" /></label>{settings.sereinHandoffAt && <small>最後に写した日: {new Date(settings.sereinHandoffAt).toLocaleString("ja-JP")}</small>}<div><button className="softButton" onClick={onHandoff}>全頁を保存箱へ写す</button></div><p className="footnote">パソコンでSerein HouseのAPIが動いている時だけ使える。スマホだけの時は、下のJSON避難を使える。</p></section>
    <section className="backup"><h2>帳面の避難</h2><p>すべての記録を端末のダウンロードへJSONとして保存する。機種変更やブラウザ変更の前は保存し、移した先で読み込む。</p>{settings.backupAt && <small>最後の避難: {new Date(settings.backupAt).toLocaleString("ja-JP")}</small>}<div><button className="softButton" onClick={onExport}>すべてをJSONにする</button><button className="softButton" onClick={onImport}>JSONを読み込む</button></div></section>
    <section className="backup cleanup"><h2>記録を整理する（必要な時だけ）</h2><p>記録はとても軽いので、容量のために消す必要はほとんどない。整理したい時だけ使う。</p><label>この日より前の記録を対象にする<input type="date" value={cleanupDate} onChange={(event) => { setCleanupDate(event.target.value); setCleanupStep("idle"); }} /></label>{cleanupStep === "idle" && <button className="softButton" onClick={() => setCleanupStep("backup")} disabled={!cleanupCount}>JSON保存を確認して削除へ進む</button>}{cleanupStep === "backup" && <div className="deleteConfirm"><p>削除前に、全記録をJSONに保存した？</p><small>保存しておけば、必要になった時に「JSONを読み込む」で戻せる。</small><div><button className="softButton" onClick={onExport}>先にJSON保存する</button><button className="rustButton" onClick={() => setCleanupStep("confirm")}>保存したので続ける</button></div></div>}{cleanupStep === "confirm" && <div className="deleteConfirm"><p>{cleanupDate.replace(/-/g, "/")}より前の記録 {cleanupCount}件を本当に削除する？</p><small>この操作は元に戻せない。JSONに保存したデータは残る。</small><div><button className="softButton" onClick={() => setCleanupStep("idle")}>やめる</button><button className="rustButton" onClick={() => { onDeleteBefore(cleanupDate); setCleanupStep("idle"); }}>削除する</button></div></div>}</section>
    <fieldset className="settingsGroup colorSecret"><legend>色を変える（そっと）</legend><p>記録の内容は変わらない。落ち着く一冊を選べる。</p><div className="themeChoices">{([ ["night", "夜の書斎"], ["paper", "生成りの紙"], ["forest", "深い森"], ["rose", "葡萄の余韻"] ] as const).map(([theme, label]) => <button key={theme} className={settings.theme === theme ? "selected " + theme : theme} onClick={() => setSettings({ ...settings, theme })}>{label}</button>)}</div></fieldset><p className="codeDate">コード最終更新日: 2026年7月21日</p>
  </section>;
}

function Clinic({ entries, settings }: { entries: LifeEntry[]; settings: AkariSettings }) {
  const [showTroubles, setShowTroubles] = useState(false);
  const stats = useMemo(() => clinicStats(entries), [entries]);
  return <section className="paper clinic"><p className="eyebrow">通院のメモ</p><h1>過去30日</h1>
    <p className="clinicNote">今日を含む過去30日。記録がない日は「していない」とは決めつけない。</p>
    <div className="clinicStats"><div>食事 <b>{stats.meals}</b><small>/ 90回</small></div><div>睡眠 <b>{stats.sleep}</b><small>平均（時刻を記録した日）</small></div><div>薬 <b>{stats.medicine}</b><small>/ 30日</small></div><div>入浴 <b>{stats.bath}</b><small>/ 30日</small></div><div>仕事・作業所 <b>{stats.work}</b><small>/ 30日</small></div><div>体調不良 <b>{stats.condition}</b><small>/ 30日</small></div><div>記録 <b>{stats.recordedDays}</b><small>/ 30日</small></div></div>
    <section className="troubleList"><button className="softButton" onClick={() => setShowTroubles(!showTroubles)}>{showTroubles ? "困りごとのメモ（読み返し・通院時用）を隠す" : "困りごとのメモ（読み返し・通院時用）を見る"}</button>
      {showTroubles && <><p>口頭で伝えたいものだけ、ここを見ながら話せる。会話のAIにはまだ渡らない。</p>{stats.troubles.length ? <ul>{stats.troubles.map((entry) => <li key={entry.date}><b>{entry.date.replace(/-/g, "/")}</b><span>{entry.troubleNote!.trim()}</span></li>)}</ul> : <p>この30日には、困りごとのメモはない。</p>}</>}</section>
    {settings.clinicHospitalDetails && <section className="troubleList"><p>🏥 病院で言われたこと</p>{stats.hospitalDetails.length ? <ul>{stats.hospitalDetails.map((entry) => <li key={entry.date}><b>{entry.date.replace(/-/g, "/")}</b><span>{entry.hospitalNote!.trim()}</span></li>)}</ul> : <p>この30日には、病院で言われたことの記録はない。</p>}</section>}{settings.clinicDiaryDetails && <section className="troubleList"><p>📕 今日のことば</p>{stats.diaryDetails.length ? <ul>{stats.diaryDetails.map((entry) => <li key={entry.date}><b>{entry.date.replace(/-/g, "/")}</b><span>{entry.note.trim()}</span></li>)}</ul> : <p>この30日には、日記の記録はない。</p>}</section>}{settings.clinicMealDetails && <section className="troubleList"><p>🍚 食事の内容</p>{stats.mealDetails.length ? <ul>{stats.mealDetails.map((entry) => <li key={entry.date}><b>{entry.date.replace(/-/g, "/")}</b><span>{[["朝", entry.mealNotes?.breakfast], ["昼", entry.mealNotes?.lunch], ["夜", entry.mealNotes?.dinner]].filter(([, value]) => value?.trim()).map(([label, value]) => `${label}: ${value}`).join(" / ")}</span></li>)}</ul> : <p>この30日には、食事内容の記録はない。</p>}</section>}
  </section>;
}

function localDate(daysAgo: number) {
  const value = new Date(); value.setHours(12, 0, 0, 0); value.setDate(value.getDate() - daysAgo);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function clinicStats(entries: LifeEntry[]) {
  const end = localDate(0), start = localDate(29);
  const period = entries.filter((entry) => entry.date >= start && entry.date <= end);
  const meals = period.reduce((sum, entry) => sum + (entry.meals.breakfast ? 1 : 0) + (entry.meals.lunch ? 1 : 0) + (entry.meals.dinner ? 1 : 0), 0);
  const medicine = period.filter((entry) => entry.medicine).length;
  const sleeps = period.map(sleepMinutes).filter((value): value is number => value !== null);
  const bath = period.filter((entry) => entry.activities.bath).length;
  const troubles = period.filter((entry) => entry.troubleNote?.trim()).sort((a, b) => b.date.localeCompare(a.date));
  const diaryDetails = period.filter((entry) => entry.note.trim()).sort((a, b) => b.date.localeCompare(a.date));
  const mealDetails = period.filter((entry) => Object.values(entry.mealNotes ?? {}).some((value) => value?.trim())).sort((a, b) => b.date.localeCompare(a.date));
  const hospitalDetails = period.filter((entry) => entry.hospitalNote?.trim()).sort((a, b) => b.date.localeCompare(a.date));
  return { meals, medicine, sleep: sleeps.length ? durationText(Math.round(sleeps.reduce((sum, value) => sum + value, 0) / sleeps.length)) : "—", bath, work: period.filter((entry) => entry.activities.work).length, condition: period.filter((entry) => entry.activities.condition).length, recordedDays: period.length, troubles, diaryDetails, mealDetails, hospitalDetails };
}

function sleepMinutes(entry: LifeEntry) { if (!entry.bedtimePrev || !entry.wakeTime) return null; const toMinutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }; const result = toMinutes(entry.wakeTime) - toMinutes(entry.bedtimePrev); return result <= 0 ? result + 24 * 60 : result; }
function durationText(minutes: number) { return `${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ""}`; }

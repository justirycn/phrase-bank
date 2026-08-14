"use client";
import { useEffect, useRef, useState } from "react";
import { AppIcon } from "../AppIcon";
import type { AppPreferences, Category, Phrase, SpeechPreferences } from "../../domain/types";
import { validateCategoryName } from "../../domain/validation";
import { backupFileName, parseBackup } from "../../storage/backup";
import type { PhraseRepository } from "../../storage/repository";
type Repository = PhraseRepository;
const defaultSpeechPreferences: SpeechPreferences = { accent: "en-US", autoSpeak: true };

export default function Settings({ repository, categories, phrases, appPreferences, refresh, setNotice, setError }: { repository: Repository; categories: Category[]; phrases: Phrase[]; appPreferences: AppPreferences; refresh: () => Promise<void>; setNotice: (s: string) => void; setError: (s: string) => void }) {
  const [name, setName] = useState("");
  const [masteryGoal, setMasteryGoal] = useState(String(appPreferences.dailyMasteryGoal));
  const [savingMasteryGoal, setSavingMasteryGoal] = useState(false);
  const [speechSettings, setSpeechSettings] = useState(() => ({ repository, preferences: defaultSpeechPreferences, loading: true }));
  const speechPreferences = speechSettings.repository === repository ? speechSettings.preferences : defaultSpeechPreferences;
  const speechPreferencesLoading = speechSettings.repository !== repository || speechSettings.loading;
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const saveSequence = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const persistedPreferences = useRef<SpeechPreferences>(defaultSpeechPreferences);
  useEffect(() => {
    const generation = ++loadGeneration.current;
    mounted.current = true;
    saveSequence.current = 0;
    saveQueue.current = Promise.resolve();
    persistedPreferences.current = defaultSpeechPreferences;
    repository.getSpeechPreferences()
      .then((preferences) => {
        if (!mounted.current || loadGeneration.current !== generation) return;
        persistedPreferences.current = preferences;
        setSpeechSettings({ repository, preferences, loading: false });
      })
      .catch(() => {
        if (!mounted.current || loadGeneration.current !== generation) return;
        setSpeechSettings({ repository, preferences: defaultSpeechPreferences, loading: false });
        setError("语音偏好暂时无法读取，已使用默认设置。");
      });
    return () => { mounted.current = false; loadGeneration.current += 1; };
  }, [repository, setError]);
  const saveSpeechPreferences = (preferences: SpeechPreferences) => {
    const generation = loadGeneration.current;
    const sequence = ++saveSequence.current;
    setSpeechSettings({ repository, preferences, loading: false });
    const persist = async () => {
      try {
        await repository.saveSpeechPreferences(preferences);
        if (!mounted.current || loadGeneration.current !== generation) return;
        persistedPreferences.current = preferences;
      } catch {
        if (!mounted.current || loadGeneration.current !== generation || sequence !== saveSequence.current) return;
        setSpeechSettings({ repository, preferences: persistedPreferences.current, loading: false });
        setError("语音偏好暂时无法保存，已恢复上次设置。");
      }
    };
    saveQueue.current = saveQueue.current.then(persist, persist);
  };
  const addCategory = async () => { const error = validateCategoryName(name, categories.map((c) => c.name)); if (error) return setError(error); const now = new Date().toISOString(); await repository.saveCategory({ id: crypto.randomUUID(), name: name.trim(), isDefault: false, createdAt: now, updatedAt: now }); setName(""); await refresh(); setNotice("分类已添加"); };
  const saveMasteryGoal = async () => {
    const value = Number(masteryGoal);
    if (!Number.isInteger(value) || value <= 0) return setError("每日答对目标必须是正整数");
    setSavingMasteryGoal(true);
    try {
      await repository.saveAppPreferences({ dailyMasteryGoal: value });
      await refresh();
      setNotice("每日答对目标已保存");
    } catch {
      setMasteryGoal(String(appPreferences.dailyMasteryGoal));
      setError("每日答对目标保存失败，已恢复上次设置");
    } finally { setSavingMasteryGoal(false); }
  };
  const exportData = async () => { const snapshot = await repository.exportSnapshot(); const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = backupFileName(); link.click(); URL.revokeObjectURL(url); setNotice("备份文件已导出"); };
  const importData = async (file?: File) => { if (!file) return; try { const backup = parseBackup(await file.text()); const policy = confirm("遇到重复记录时，用备份中的内容覆盖吗？\n选择“取消”将跳过重复项。") ? "overwrite" : "skip"; await repository.importSnapshot(backup, policy); await refresh(); setNotice("备份已成功导入"); } catch (e) { setError(e instanceof Error ? e.message : "导入失败"); } };
  return <><header className="top"><div><h1>设置</h1><p>管理你的分类与本地数据。</p></div></header>
    <section className="settings-card mastery-goal-settings"><div className="section-title"><div><span>每日答对目标</span><small>达标后仍可继续学习</small></div></div><div className="mastery-goal-control"><label htmlFor="daily-mastery-goal">每天目标句数</label><input id="daily-mastery-goal" aria-label="每日答对目标" type="number" inputMode="numeric" min="1" step="1" value={masteryGoal} onChange={(event) => setMasteryGoal(event.target.value)} /><button onClick={saveMasteryGoal} disabled={savingMasteryGoal}>保存每日目标</button></div></section>
    <section className="settings-card"><div className="section-title"><div><span>分类管理</span><small>{categories.length} 个分类</small></div></div><div className="category-list">{categories.map((c) => <div key={c.id}><span className="category-dot" /><b>{c.name}</b><small>{phrases.filter((p) => p.categoryId === c.id).length} 条</small>{!c.isDefault && <button onClick={async () => { const target = categories.find((x) => x.id !== c.id); if (!target || !confirm(`删除“${c.name}”并将内容移到“${target.name}”？`)) return; await repository.deleteCategoryAndMigrate(c.id, target.id); await refresh(); }}>删除</button>}</div>)}</div><div className="add-category"><input aria-label="新分类名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="新分类名称" /><button onClick={addCategory}>添加</button></div></section>
    <section className="settings-card speech-settings"><div className="section-title"><div><span>语音训练</span><small>SPEAKING PRACTICE</small></div></div>
      <label className="speech-toggle"><span><b>自动朗读答案</b><small>显示英文后自动播放发音</small></span><input aria-label="自动朗读答案" type="checkbox" disabled={speechPreferencesLoading} checked={speechPreferences.autoSpeak} onChange={(event) => saveSpeechPreferences({ ...speechPreferences, autoSpeak: event.target.checked })} /></label>
      <fieldset className="accent-options" disabled={speechPreferencesLoading}><legend>朗读口音</legend><label><input type="radio" name="speech-accent" value="en-US" checked={speechPreferences.accent === "en-US"} onChange={() => saveSpeechPreferences({ ...speechPreferences, accent: "en-US" })} /><span>美式英语</span></label><label><input type="radio" name="speech-accent" value="en-GB" checked={speechPreferences.accent === "en-GB"} onChange={() => saveSpeechPreferences({ ...speechPreferences, accent: "en-GB" })} /><span>英式英语</span></label></fieldset>
    </section>
    <section className="settings-card"><div className="section-title"><div><span>数据备份</span><small>BACKUP & RESTORE</small></div></div><div className="warning"><b>数据只保存在当前设备</b><p>更换设备、卸载浏览器或清除网站数据前，请先导出备份。</p></div><button className="settings-action" onClick={exportData}><span><AppIcon name="download" size={20} /></span><div><b>导出备份</b><small>下载完整 JSON 文件</small></div><i><AppIcon name="next" size={20} /></i></button><label className="settings-action"><span><AppIcon name="upload" size={20} /></span><div><b>导入备份</b><small>从以前的备份恢复</small></div><i><AppIcon name="next" size={20} /></i><input type="file" accept="application/json,.json" onChange={(e) => importData(e.target.files?.[0])} hidden /></label></section>
    <p className="version">Phrase Bank · 本地版 MVP</p>
  </>;
}
